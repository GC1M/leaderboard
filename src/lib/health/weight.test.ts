import { loadHealthKit } from './healthkit';
import { displayWeight, normalizeWeight, readWeightHistory, type WeightSample } from './weight';
jest.mock('./healthkit', () => ({ HEALTH_TYPES: { weight: 'HKQuantityTypeIdentifierBodyMass' }, loadHealthKit: jest.fn() }));
const sample = (uuid: string, time: string, quantity=80, unit='kg'): WeightSample => ({ uuid, startDate: new Date(time), quantity, unit });
test('keeps several readings per day and chooses deterministic ties without averaging', () => {
 const a=sample('a','2026-10-25T08:00:00Z',80), b=sample('b','2026-10-25T08:00:00Z',81), c=sample('c','2026-10-25T20:00:00Z',82);
 expect(normalizeWeight([c,b,a,a])).toEqual(normalizeWeight([a,b,c]));
 expect(normalizeWeight([a,b,c]).map((r)=>r.kg)).toEqual([81,82]);
});
test('converts pounds without rounding storage precision', () => {
 const row=normalizeWeight([sample('x','2026-10-25T08:00:00Z',200,'lb')])[0];
 expect(row.kg).toBe(90.718474);
 expect(displayWeight(row.kg,'lb')).toBeCloseTo(200);
});
test.each([0,-1,NaN,Infinity,1000])('rejects invalid mass %p rather than inventing zero', (n)=>{
 expect(()=>normalizeWeight([sample('x','2026-10-25T08:00:00Z',n)])).toThrow('Invalid weight');
});
test('finds the latest reading even when it is years older than the history window', async () => {
 const old=sample('old','2020-01-01T12:00:00Z');
 const queryQuantitySamples=jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([old]).mockResolvedValueOnce([old]);
 (loadHealthKit as jest.Mock).mockReturnValue({ queryQuantitySamples });
 const rows=await readWeightHistory(90,new Date('2026-10-25T12:00:00Z'));
 expect(rows).toEqual([{ sampleId:'old',measuredAt:'2020-01-01T12:00:00.000Z',kg:80 }]);
 expect(queryQuantitySamples.mock.calls[1][1]).not.toHaveProperty('filter.date.startDate');
});
test('no reading stays empty, query failures propagate', async () => {
 const queryQuantitySamples=jest.fn().mockResolvedValue([]);
 (loadHealthKit as jest.Mock).mockReturnValue({ queryQuantitySamples });
 expect(await readWeightHistory(7)).toEqual([]);
 queryQuantitySamples.mockRejectedValue(new Error('read failed'));
 await expect(readWeightHistory(7)).rejects.toThrow('read failed');
});
