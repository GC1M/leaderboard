import { deriveChanges, mergeSamples, reconcileHealth, sampleDates, type ChangePage, type HealthJournal, type JournalState, type StoredSample } from './changes';
import { loadHealthKit } from './healthkit';
jest.mock('./healthkit',()=>({HEALTH_TYPES:{steps:'steps'},loadHealthKit:jest.fn()}));
const sample=(id:string,start='2026-10-25T01:00:00',end='2026-10-25T02:00:00',value=1):StoredSample=>({id,start:new Date(start).toISOString(),end:new Date(end).toISOString(),value});
const page=(samples:StoredSample[]=[],deleted:string[]=[]):ChangePage=>({samples,deleted,anchor:'next',hasMore:false});
function memory(initial:JournalState|null=null) {
 let state=initial;
 const journal:HealthJournal={read:async()=>state?JSON.parse(JSON.stringify(state)):null,write:async(_m,s)=>{state=JSON.parse(JSON.stringify(s));}};
 return {journal,state:()=>state};
}
test('sample date span handles midnight exclusively and duplicate IDs are idempotent',()=>{
 expect(sampleDates(sample('x','2026-10-24T23:50:00','2026-10-25T00:00:00'))).toEqual(['2026-10-24']);
 const p=page([sample('x')]);expect(mergeSamples(mergeSamples([],p),p)).toHaveLength(1);
});
test('removing the final known sleep sample removes that day, empty read alone never does',async()=>{
 const x=sample('x');
 expect((await deriveChanges('sleep',[x],[],page([],['x']))).removeDaily).toEqual(['2026-10-25']);
 expect(await deriveChanges('sleep',[x],[x],page())).toEqual({daily:[],removeDaily:[],weight:[],removeWeight:[]});
});
test('deleting one overlapping sleep sample recomputes only real remaining asleep time',async()=>{
 const a=sample('a'),b=sample('b','2026-10-25T01:30:00','2026-10-25T02:30:00');
 const c=await deriveChanges('sleep',[a,b],[b],page([],['a']));
 expect(c.daily[0].value).toBe(60);expect(c.removeDaily).toEqual([]);
});
test('weight deletion restores a same-timestamp source candidate and final deletion removes the record',async()=>{
 const a=sample('a',undefined,undefined,80),b=sample('b',undefined,undefined,81);
 expect((await deriveChanges('weight',[a,b],[a],page([],['b']))).weight[0].kg).toBe(80);
 expect((await deriveChanges('weight',[a],[],page([],['a']))).removeWeight).toEqual([a.start]);
});
test('step corrections use native statistics (not raw source sums); ambiguous statistics do not erase data',async()=>{
 const queryStatisticsForQuantity=jest.fn().mockResolvedValue({sumQuantity:{quantity:150}});
 (loadHealthKit as jest.Mock).mockReturnValue({queryStatisticsForQuantity});
 const a=sample('a'),b=sample('b');
 expect((await deriveChanges('steps',[a,b],[b],page([],['a']))).daily).toEqual([{date:'2026-10-25',value:150}]);
 queryStatisticsForQuantity.mockResolvedValue({});
 expect((await deriveChanges('steps',[a,b],[b],page([],['a']))).daily).toEqual([]);
 expect((await deriveChanges('steps',[a],[],page([],['a']))).removeDaily).toEqual(['2026-10-25']);
});
test('failed upload persists exact pending payload and replays it without another Health read',async()=>{
 const mem=memory(),query=jest.fn().mockResolvedValue(page([sample('x')]));
 const upload=jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
 const checkOwner=jest.fn().mockResolvedValue(undefined);
 await expect(reconcileHealth('sleep',{journal:mem.journal,query,upload,checkOwner})).rejects.toThrow('offline');
 expect(mem.state()?.anchor).toBeUndefined();expect(mem.state()?.pending).toBeDefined();
 await reconcileHealth('sleep',{journal:mem.journal,query,upload,checkOwner});
 expect(query).toHaveBeenCalledTimes(1);expect(upload.mock.calls[0]).toEqual(upload.mock.calls[1]);
 expect(mem.state()?.anchor).toBe('next');expect(mem.state()?.pending).toBeUndefined();
});
test('bounded initial import resumes from checkpoint and keeps a fixed historical predicate',async()=>{
 const mem=memory(),query=jest.fn().mockResolvedValue({...page([sample('x')]),hasMore:true});
 const options={journal:mem.journal,query,upload:jest.fn(),checkOwner:jest.fn(),maxPages:1,now:new Date('2026-10-25T12:00:00Z')};
 expect((await reconcileHealth('sleep',options)).hasMore).toBe(true);
 const from=mem.state()?.from;
 query.mockResolvedValue(page());
 await reconcileHealth('sleep',{...options,now:new Date('2026-12-25T12:00:00Z')});
 expect(query.mock.calls[1][1]).toMatchObject({anchor:'next',from});
});
test('old tombstones outside the recent window still reconcile, unknown IDs never delete',async()=>{
 const old=sample('old','2020-01-01T01:00:00','2020-01-01T02:00:00');
 const mem=memory({from:'2019-01-01T00:00:00Z',anchor:'old-anchor',samples:[old]});
 const upload=jest.fn();
 await reconcileHealth('sleep',{journal:mem.journal,query:async()=>page([],['old','unknown']),upload,checkOwner:async()=>{}});
 expect(upload.mock.calls[0][1].removeDaily).toEqual(['2020-01-01']);
});
test('account switch after native query prevents journal or remote writes',async()=>{
 const mem=memory(),upload=jest.fn();let active=true;
 const checkOwner=async()=>{if(!active)throw new Error('account changed');};
 await expect(reconcileHealth('sleep',{journal:mem.journal,upload,checkOwner,query:async()=>{active=false;return page([sample('x')]);}})).rejects.toThrow('account changed');
 expect(mem.state()).toBeNull();expect(upload).not.toHaveBeenCalled();
});
test('empty initial read remains retryable after granting permission',async()=>{
 const mem=memory();
 await reconcileHealth('sleep',{journal:mem.journal,query:async()=>page(),upload:async()=>{},checkOwner:async()=>{}});
 expect(mem.state()?.anchor).toBeUndefined();
});

test('history recheck resumes after pending retry instead of losing the reset request',async()=>{
 const changes={daily:[],removeDaily:[],weight:[],removeWeight:[]};
 const mem=memory({from:'2026-01-01T00:00:00Z',samples:[sample('x')],pending:{anchor:'pending',changes,hasMore:false},resetAfterPending:true});
 const query=jest.fn().mockResolvedValue(page());
 await reconcileHealth('sleep',{journal:mem.journal,query,upload:async()=>{},checkOwner:async()=>{}});
 expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0][1].anchor).toBeUndefined();
});
test('sleep recomputation removes previously stored date keys after timezone reassignment',async()=>{
 const x=sample('x');
 const mem=memory({from:'2026-01-01T00:00:00Z',anchor:'a',samples:[x],dailyKeys:['2026-10-24']});
 const upload=jest.fn();
 await reconcileHealth('sleep',{journal:mem.journal,query:async()=>page([x]),upload,checkOwner:async()=>{}});
 expect(upload.mock.calls[0][1].removeDaily).toContain('2026-10-24');
});
test('a corrected sample replaces the old value instead of adding to it',async()=>{
 const a=sample('a',undefined,undefined,80),fixed=sample('a',undefined,undefined,79);
 const merged=mergeSamples([a],page([fixed]));
 expect(merged).toHaveLength(1);expect(merged[0].value).toBe(79);
 expect((await deriveChanges('weight',[a],merged,page([fixed]))).weight[0].kg).toBe(79);
});
test('invalid changes from Health are rejected rather than stored',()=>{
 expect(()=>mergeSamples([],page([sample('x','2026-10-25T02:00:00','2026-10-25T01:00:00')]))).toThrow('Invalid Health change');
});
