import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth';
import { secureStorage } from '@/lib/secure-storage';
import { reconcileHealth } from './changes';
import { createHealthCoordinator, HEALTH_METRICS, initialHealthState, type HealthConnection, type HealthCoordinator } from './coordinator';
import { getHealthAccess, requestHealthAccess } from './healthkit';
import { getHealthDeviceId, healthJournal, resetHealthAnchors } from './journal';
import { assertHealthOwner } from './owner';
import { uploadHealthChanges } from './upload';

export const SYNC_DAYS = 7; // existing My Steps view; import history is 90 days, not seven
const HealthContext = createContext<HealthCoordinator | null>(null);
const idle = initialHealthState();
const subscribeIdle = () => () => {};
const idleSnapshot = () => idle;

function createAccountSync(userId: string) {
  const key=`health-connection-${userId}`;
  let deviceId: Promise<string> | undefined;
  return createHealthCoordinator({
    checkAccount:()=>assertHealthOwner(userId),
    load:async()=>{const raw=await secureStorage.getItem(key);return raw?JSON.parse(raw) as HealthConnection:null;},
    save:async(value)=>{await secureStorage.setItem(key,JSON.stringify(value));},
    requestAccess:async()=>{if(await getHealthAccess('steps')==='unavailable')throw new Error('Apple Health requires the native iPhone app build.');await requestHealthAccess();},
    access:getHealthAccess,
    recheck:()=>resetHealthAnchors(userId),
    reconcile:async(metric,checkOwner)=>{
      // Resolve once before parallel metric uploads so all use the same installation identity.
      deviceId ??= getHealthDeviceId().catch((e)=>{deviceId=undefined;throw e;});
      const device=await deviceId;
      await checkOwner();
      return reconcileHealth(metric,{journal:healthJournal(userId),checkOwner,upload:(m,c)=>uploadHealthChanges(userId,device,m,c)});
    },
  });
}

export function HealthSyncProvider({children}:{children:ReactNode}) {
  const {session}=useAuth();
  const userId=session?.user.id;
  const controller=useMemo(()=>userId?createAccountSync(userId):null,[userId]);
  const state=useSyncExternalStore(controller?.subscribe ?? subscribeIdle,controller?.getSnapshot ?? idleSnapshot);
  useEffect(()=>{
    if(!controller)return;
    void controller.initialize().then(()=>controller.sync());
    const subscription=AppState.addEventListener('change',(s)=>{if(s==='active')void controller.sync();});
    return()=>{controller.stop();subscription.remove();};
  },[controller]);
  useEffect(()=>{
    if(!controller || state.syncing || !state.connected || !HEALTH_METRICS.some((m)=>state.metrics[m].status==='importing'))return;
    // Finish a large initial import in bounded foreground slices, continuing after app reopen.
    const timer=setTimeout(()=>{if(AppState.currentState==='active')void controller.sync();},500);
    return()=>clearTimeout(timer);
  },[controller,state]);
  return <HealthContext.Provider value={controller}>{children}</HealthContext.Provider>;
}

export function useHealthSync(){
  const controller=useContext(HealthContext);
  const state=useSyncExternalStore(controller?.subscribe ?? subscribeIdle,controller?.getSnapshot ?? idleSnapshot);
  return { ...state, sync:()=>controller?.sync() ?? Promise.resolve(),
    connect:()=>controller?.connect() ?? Promise.resolve(),
    disconnect:()=>controller?.disconnect() ?? Promise.resolve(),
    recheck:()=>controller?.recheck() ?? Promise.resolve(),
  };
}

// Compatibility for existing My Steps: subscribe to the shared account coordinator rather than
// mounting a second AppState listener or running a second import alongside Summary.
export function useStepSync(onSynced?:()=>void){
  const health=useHealthSync();
  const m=health.metrics.steps;
  useEffect(()=>{if(m.status==='synced' || m.status==='unchanged' || m.status==='no-data')onSynced?.();},[m,onSynced]);
  const result = m.status==='unavailable'?{status:'unavailable' as const}:m.status==='needs-permission'?{status:'needs-permission' as const}:
    !health.connected?{status:'not-connected' as const}:m.status==='no-data'?{status:'no-data' as const}:
      m.lastSuccess?{status:'synced' as const,at:new Date(m.lastSuccess)}:null;
  return {sync:health.sync,recheck:health.recheck,connected:health.connected,syncing:health.syncing,result,error:m.error ?? health.error};
}
