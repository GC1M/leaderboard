import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth';
import { secureStorage } from '@/lib/secure-storage';
import { reconcileHealth } from './changes';
import { createHealthCoordinator, HEALTH_METRICS, initialHealthState, type HealthConnection, type HealthCoordinator } from './coordinator';
import { createExportQueue, exportWriters, initialExportState, type ExportQueue } from './export-queue';
import { healthExportMapping } from './export-mapping';
import { getHealthAccess, getHealthWriteAccess, healthUnavailableMessage, requestHealthAccess, requestHealthWriteAccess, type HealthWriteType } from './healthkit';
import { deleteImportedJournal, getHealthDeviceId, healthExportStore, healthJournal, resetHealthAnchors } from './journal';
import './manual-export'; // registers the manual weight/sleep/steps writers
import { assertHealthOwner } from './owner';
import { deleteHealthImports, uploadHealthChanges } from './upload';
import './workout-export'; // registers the app-created workout writer
import './food-export'; // registers the app-created food writer

export const SYNC_DAYS = 7; // existing My Steps view; import history is 90 days, not seven
const HealthContext = createContext<HealthCoordinator | null>(null);
const ExportContext = createContext<ExportQueue | null>(null);
const idle = initialHealthState();
const idleExport = initialExportState();
const subscribeIdle = () => () => {};
const idleSnapshot = () => idle;
const idleExportSnapshot = () => idleExport;

function createAccountSync(userId: string) {
  const key=`health-connection-${userId}`;
  let deviceId: Promise<string> | undefined;
  return createHealthCoordinator({
    checkAccount:()=>assertHealthOwner(userId),
    load:async()=>{const raw=await secureStorage.getItem(key);return raw?JSON.parse(raw) as HealthConnection:null;},
    save:async(value)=>{await secureStorage.setItem(key,JSON.stringify(value));},
    requestAccess:async()=>{if(await getHealthAccess('steps')==='unavailable')throw new Error(await healthUnavailableMessage());await requestHealthAccess();},
    access:getHealthAccess,
    recheck:()=>resetHealthAnchors(userId),
    // Local journal first: if the server delete then fails, a retry still finds nothing to re-upload.
    deleteImports:async()=>{await assertHealthOwner(userId);await deleteImportedJournal(userId);await deleteHealthImports(userId);},
    reconcile:async(metric,checkOwner)=>{
      // Resolve once before parallel metric uploads so all use the same installation identity.
      deviceId ??= getHealthDeviceId().catch((e)=>{deviceId=undefined;throw e;});
      const device=await deviceId;
      await checkOwner();
      return reconcileHealth(metric,{journal:healthJournal(userId),checkOwner,upload:(m,c)=>uploadHealthChanges(userId,device,m,c)});
    },
  });
}

// Exports to Apple Health run independently of imports and of the connect consent: they need only write
// permission for the data type, which is requested separately.
function createAccountExport(userId: string) {
  let deviceId: Promise<string> | undefined;
  return createExportQueue({
    checkAccount:()=>assertHealthOwner(userId),
    store:healthExportStore(userId),
    mapping:healthExportMapping(userId,()=>(deviceId??=getHealthDeviceId().catch((e)=>{deviceId=undefined;throw e;}))),
    writers:exportWriters,
    access:getHealthWriteAccess,
  });
}

export function HealthSyncProvider({children}:{children:ReactNode}) {
  const {session}=useAuth();
  const userId=session?.user.id;
  const controller=useMemo(()=>userId?createAccountSync(userId):null,[userId]);
  const exporter=useMemo(()=>userId?createAccountExport(userId):null,[userId]);
  const state=useSyncExternalStore(controller?.subscribe ?? subscribeIdle,controller?.getSnapshot ?? idleSnapshot);
  useEffect(()=>{
    if(!exporter)return;
    void exporter.initialize().then(()=>exporter.process());
    const subscription=AppState.addEventListener('change',(s)=>{if(s==='active')void exporter.process();});
    // Sign-out or account switch stops this queue; its entries stay in that account's own local store.
    return()=>{exporter.stop();subscription.remove();};
  },[exporter]);
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
  return <HealthContext.Provider value={controller}><ExportContext.Provider value={exporter}>{children}</ExportContext.Provider></HealthContext.Provider>;
}

export function useHealthSync(){
  const controller=useContext(HealthContext);
  const state=useSyncExternalStore(controller?.subscribe ?? subscribeIdle,controller?.getSnapshot ?? idleSnapshot);
  return { ...state, sync:()=>controller?.sync() ?? Promise.resolve(),
    connect:()=>controller?.connect() ?? Promise.resolve(),
    disconnect:()=>controller?.disconnect() ?? Promise.resolve(),
    recheck:()=>controller?.recheck() ?? Promise.resolve(),
    deleteImports:()=>controller?.deleteImports() ?? Promise.resolve(),
  };
}

// Export queue status for the UI: pending/failed counts and entries with `status` and `reason` ('permission' means
// the user has not allowed writing that type). `enqueue` is what feature code calls; `allowWrite` shows Apple's sheet.
export function useHealthExport(){
  const queue=useContext(ExportContext);
  const state=useSyncExternalStore(queue?.subscribe ?? subscribeIdle,queue?.getSnapshot ?? idleExportSnapshot);
  return { ...state,
    enqueue:(...args:Parameters<ExportQueue['enqueue']>)=>queue?.enqueue(...args) ?? Promise.resolve(),
    retry:()=>queue?.process() ?? Promise.resolve(),
    discard:(kind:string)=>queue?.discard(kind) ?? Promise.resolve(),
    forget:(...args:Parameters<ExportQueue['forget']>)=>queue?.forget(...args) ?? Promise.resolve(),
    // The queue as it is now, for an action that must not act on a render-time copy.
    getEntries:()=>queue?.getSnapshot().entries ?? [],
    allowWrite:async(types:readonly HealthWriteType[])=>{await requestHealthWriteAccess(types);await queue?.process();},
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
