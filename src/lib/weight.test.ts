import { saveHealthWeight } from './weight';
const mockUpsert=jest.fn(), mockSession=jest.fn();
jest.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},from:()=>({upsert:mockUpsert})}}));
beforeEach(()=>{jest.clearAllMocks();mockSession.mockResolvedValue({data:{session:{user:{id:'a'}}}});mockUpsert.mockResolvedValue({error:null});});
const reading={sampleId:'sample',kg:80.125,measuredAt:'2026-10-25T12:00:00Z'};
test('upserts exact mass and measurement time independently of upload time',async()=>{
 await saveHealthWeight('a',[reading]);
 expect(mockUpsert).toHaveBeenCalledWith([{user_id:'a',kg:80.125,measured_at:reading.measuredAt,source:'healthkit'}],{onConflict:'user_id,measured_at,source'});
});
test('account switch and invalid readings cannot write',async()=>{
 await expect(saveHealthWeight('b',[reading])).rejects.toThrow('account changed');
 await expect(saveHealthWeight('a',[{...reading,kg:0}])).rejects.toThrow('Invalid weight');
 expect(mockUpsert).not.toHaveBeenCalled();
});
