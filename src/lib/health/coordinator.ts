import type { HealthAccess, HealthMetric } from './healthkit';
import type { ReconcileOptions } from './changes';

export const HEALTH_METRICS: HealthMetric[] = ['steps','sleep','weight','workouts'];
export type MetricSyncState = {
  status: 'idle' | 'syncing' | 'unavailable' | 'needs-permission' | 'no-data' | 'importing' | 'synced' | 'unchanged' | 'error';
  lastSuccess: string | null; knownSamples: number; error: string | null;
  truncatedFrom?: string; // Health Connect only let the import read back to this time (no history access)
};
export type HealthSyncState = { ready: boolean; connected: boolean; syncing: boolean; error: string | null; metrics: Record<HealthMetric, MetricSyncState> };
export type HealthConnection = { connected: boolean; lastSuccess: Partial<Record<HealthMetric,string>> };
export type CoordinatorDependencies = {
  checkAccount: () => Promise<void>;
  load: () => Promise<HealthConnection | null>;
  save: (connection: HealthConnection) => Promise<void>;
  requestAccess: () => Promise<void>;
  access: (metric: HealthMetric) => Promise<HealthAccess>;
  reconcile: (metric: HealthMetric, checkOwner: ReconcileOptions['checkOwner']) => Promise<{ hasMore: boolean; knownSamples: number; written: number; truncatedFrom?: string }>;
  recheck: () => Promise<void>;
  deleteImports: () => Promise<void>;
};
const initialMetric = (): MetricSyncState => ({ status:'idle',lastSuccess:null,knownSamples:0,error:null });
export const initialHealthState = (): HealthSyncState => ({ ready:false,connected:false,syncing:false,error:null,metrics:{steps:initialMetric(),sleep:initialMetric(),weight:initialMetric(),workouts:initialMetric()} });

// One controller per signed-in account. Callers share the active promise; reconnect/sign-out
// invalidate every in-flight continuation, including writes after long-running native queries.
export function createHealthCoordinator(deps: CoordinatorDependencies) {
  let state = initialHealthState();
  let alive = true, epoch = 0;
  let flight: Promise<void> | null = null;
  let deleting: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<HealthSyncState>) => { if (alive) { state = { ...state,...patch }; listeners.forEach((f)=>f()); } };
  const metric = (key: HealthMetric, patch: Partial<MetricSyncState>) => emit({metrics:{...state.metrics,[key]:{...state.metrics[key],...patch}}});
  const account = async (token: number) => {
    if (!alive || epoch !== token) throw new Error('Health account changed.');
    await deps.checkAccount();
    if (!alive || epoch !== token) throw new Error('Health account changed.');
  };
  let persistence: Promise<void> = Promise.resolve();
  const persist = (value: HealthConnection, token: number) => {
    const operation = persistence.catch(() => {}).then(async () => { await account(token); await deps.save(value); await account(token); });
    persistence = operation;
    return operation;
  };
  const connection = (): HealthConnection => ({connected:state.connected,lastSuccess:Object.fromEntries(HEALTH_METRICS.filter((m)=>state.metrics[m].lastSuccess).map((m)=>[m,state.metrics[m].lastSuccess!]))});
  const sync = (): Promise<void> => {
    if (flight) return flight;
    if (!alive || !state.ready || !state.connected) return Promise.resolve();
    const token=epoch;
    emit({syncing:true,error:null});
    const checkOwner=async()=>{await account(token);if(!state.connected)throw new Error('Health disconnected.');};
    const run=async()=>{
      await checkOwner();
      await Promise.all(HEALTH_METRICS.map(async(m)=>{
        metric(m,{status:'syncing',error:null});
        try {
          const access=await deps.access(m);
          await checkOwner();
          if(access!=='asked'){metric(m,{status:access==='unavailable'?'unavailable':'needs-permission'});return;}
          const result=await deps.reconcile(m,checkOwner);
          await checkOwner();
          metric(m,{
            status:result.hasMore?'importing':result.knownSamples===0?'no-data':result.written===0?'unchanged':'synced',
            knownSamples:result.knownSamples,truncatedFrom:result.truncatedFrom,
            ...(!result.hasMore && result.written>0 ? {lastSuccess:new Date().toISOString()} : {}),
          });
        }catch(e){if(alive && epoch===token)metric(m,{status:'error',error:e instanceof Error?e.message:'Health sync failed. Try again.'});}
      }));
      await checkOwner();
      await persist(connection(),token);
      await checkOwner();
    };
    flight=run().catch((e)=>{if(alive && epoch===token)emit({error:e instanceof Error?e.message:'Health sync failed.'});}).finally(()=>{flight=null;emit({syncing:false});});
    return flight;
  };
  return {
    getSnapshot:()=>state,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
    async initialize(){
      alive=true;
      const token=++epoch;
      try{
        const stored=await deps.load();await account(token);
        for(const m of HEALTH_METRICS)if(stored?.lastSuccess[m])metric(m,{lastSuccess:stored.lastSuccess[m]!});
        emit({ready:true,connected:stored?.connected===true,error:null});
      }catch(e){if(alive && epoch===token)emit({ready:true,error:e instanceof Error?e.message:'Could not load Health connection.'});}
    },
    async connect(){
      // Reconnecting mid-delete would re-upload rows the delete then wipes.
      if(deleting)await deleting.catch(()=>{});
      const token=++epoch;
      await account(token);
      await deps.requestAccess();await account(token);
      await persist({...connection(),connected:true},token);await account(token);
      emit({ready:true,connected:true,error:null});
      if(flight)await flight;
      await account(token);return sync();
    },
    async disconnect(){
      const token=++epoch;emit({connected:false});
      await account(token);await persist({...connection(),connected:false},token);await account(token);
    },
    // Stops imports, waits out any upload in flight, then deletes imported data. Imports stay off until the
    // user reconnects, which starts a fresh history import.
    deleteImports(){
      const token=++epoch;emit({connected:false,metrics:initialHealthState().metrics});
      const run=async()=>{
        await account(token);await persist({connected:false,lastSuccess:{}},token);
        if(flight)await flight;
        await account(token);await deps.deleteImports();await account(token);
      };
      const current=deleting=run().finally(()=>{if(deleting===current)deleting=null;});
      return current;
    },
    async recheck(){
      if(flight)await flight;
      const token=epoch;await account(token);
      if(!state.connected)return;
      await deps.recheck();await account(token);return sync();
    },
    sync,
    stop(){alive=false;epoch++;listeners.clear();},
  };
}
export type HealthCoordinator = ReturnType<typeof createHealthCoordinator>;
