import { createHealthCoordinator, type CoordinatorDependencies } from './coordinator';
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>((r)=>{resolve=r;});return {promise,resolve};};
function setup(connected=true){
 const deps:CoordinatorDependencies={checkAccount:jest.fn(async()=>{}),load:jest.fn(async()=>({connected,lastSuccess:{}})),save:jest.fn(async()=>{}),requestAccess:jest.fn(async()=>{}),access:jest.fn(async()=>'asked'),reconcile:jest.fn(async(_m,guard)=>{await guard();return {hasMore:false,written:1,knownSamples:2};}),recheck:jest.fn(async()=>{}),deleteImports:jest.fn(async()=>{})};
 return {deps,c:createHealthCoordinator(deps)};
}
test('does not read Health until this account explicitly connects',async()=>{
 const {c,deps}=setup(false);await c.initialize();await c.sync();
 expect(deps.access).not.toHaveBeenCalled();
 await c.connect();expect(deps.requestAccess).toHaveBeenCalledTimes(1);expect(deps.reconcile).toHaveBeenCalledTimes(3);
 expect(c.getSnapshot().connected).toBe(true);
});
test('all concurrent callers share one import; permission gaps do not block other metrics',async()=>{
 const {c,deps}=setup();const wait=deferred<void>();await c.initialize();
 (deps.access as jest.Mock).mockImplementation(async(m)=>m==='sleep'?'not-asked':'asked');
 (deps.reconcile as jest.Mock).mockImplementation(async()=>{await wait.promise;return {hasMore:false,written:1,knownSamples:1};});
 const a=c.sync(),b=c.sync();expect(a).toBe(b);wait.resolve();await a;
 expect(deps.reconcile).toHaveBeenCalledTimes(2);expect(c.getSnapshot().metrics.sleep.status).toBe('needs-permission');
 expect(c.getSnapshot().metrics.weight.status).toBe('synced');
});
test('one metric failure preserves its prior success time and other successful imports',async()=>{
 const {c,deps}=setup();await c.initialize();await c.sync();const previous=c.getSnapshot().metrics.sleep.lastSuccess;
 (deps.reconcile as jest.Mock).mockImplementation(async(m)=>{if(m==='sleep')throw new Error('offline');return {hasMore:false,written:1,knownSamples:1};});
 await c.sync();expect(c.getSnapshot().metrics.sleep).toMatchObject({status:'error',lastSuccess:previous,error:'offline'});
 expect(c.getSnapshot().metrics.weight.status).toBe('synced');
});
test('bounded pending history is importing, not a completed success',async()=>{
 const {c,deps}=setup();await c.initialize();(deps.reconcile as jest.Mock).mockResolvedValue({hasMore:true,written:500,knownSamples:500});
 await c.sync();expect(c.getSnapshot().metrics.steps).toMatchObject({status:'importing',lastSuccess:null,knownSamples:500});
});
test('empty responses never say denied or update last-success time',async()=>{
 const {c,deps}=setup();await c.initialize();(deps.reconcile as jest.Mock).mockResolvedValue({hasMore:false,written:0,knownSamples:0});
 await c.sync();expect(c.getSnapshot().metrics.sleep).toMatchObject({status:'no-data',lastSuccess:null});
});
test('sign-out while native work is pending invalidates the upload guard',async()=>{
 const {c,deps}=setup();await c.initialize();const wait=deferred<void>(),started=deferred<void>();
 (deps.reconcile as jest.Mock).mockImplementation(async(_m,guard)=>{started.resolve();await wait.promise;await guard();return {hasMore:false,written:1,knownSamples:1};});
 const p=c.sync();await started.promise;c.stop();wait.resolve();await p;
 expect(deps.save).not.toHaveBeenCalled();
});
test('disconnect invalidates old work and persists off state before a new login can read it',async()=>{
 const {c,deps}=setup();await c.initialize();const wait=deferred<void>(),started=deferred<void>();
 (deps.reconcile as jest.Mock).mockImplementation(async(_m,guard)=>{started.resolve();await wait.promise;await guard();return {hasMore:false,written:1,knownSamples:1};});
 const p=c.sync();await started.promise;await c.disconnect();wait.resolve();await p;
 expect(c.getSnapshot().connected).toBe(false);
 expect((deps.save as jest.Mock).mock.calls.every(([v])=>v.connected===false)).toBe(true);
});
test('React effect reactivation loads a stopped controller safely',async()=>{
 const {c}=setup();await c.initialize();c.stop();await c.initialize();await c.sync();
 expect(c.getSnapshot().metrics.steps.status).toBe('synced');
});

test('a pending metadata write cannot restore consent after disconnect',async()=>{
 const {c,deps}=setup();await c.initialize();
 const writing=deferred<void>(),release=deferred<void>();
 (deps.save as jest.Mock).mockImplementationOnce(async()=>{writing.resolve();await release.promise;});
 const running=c.sync();await writing.promise;
 const off=c.disconnect();release.resolve();await Promise.all([running,off]);
 const calls=(deps.save as jest.Mock).mock.calls;
 expect(calls[calls.length-1][0].connected).toBe(false);
});

test('deleting imports stops sync, waits for the upload in flight, and stays off',async()=>{
 const {c,deps}=setup();await c.initialize();const wait=deferred<void>(),started=deferred<void>(),order:string[]=[];
 (deps.reconcile as jest.Mock).mockImplementation(async(_m,guard)=>{started.resolve();await wait.promise;order.push('upload');await guard();return {hasMore:false,written:1,knownSamples:1};});
 (deps.deleteImports as jest.Mock).mockImplementation(async()=>{order.push('delete');});
 const p=c.sync();await started.promise;const d=c.deleteImports();wait.resolve();await Promise.all([p,d]);
 expect(order[order.length-1]).toBe('delete');
 expect(c.getSnapshot()).toMatchObject({connected:false});
 expect(c.getSnapshot().metrics.steps.lastSuccess).toBeNull();
 const saves=(deps.save as jest.Mock).mock.calls;expect(saves[saves.length-1][0]).toEqual({connected:false,lastSuccess:{}});
 await c.sync();expect(deps.reconcile).toHaveBeenCalledTimes(3);
});

test('connecting during a delete waits for the delete to finish first',async()=>{
 const {c,deps}=setup();await c.initialize();const wait=deferred<void>(),order:string[]=[];
 (deps.deleteImports as jest.Mock).mockImplementation(async()=>{await wait.promise;order.push('delete');});
 (deps.requestAccess as jest.Mock).mockImplementation(async()=>{order.push('connect');});
 const d=c.deleteImports();await Promise.resolve();const r=c.connect();wait.resolve();await Promise.all([d,r]);
 expect(order).toEqual(['delete','connect']);expect(c.getSnapshot().connected).toBe(true);
});
