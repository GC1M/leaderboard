import * as SecureStore from 'expo-secure-store';
import { deleteHealthJournal, getHealthDeviceId, healthJournal } from './journal';
const mockEntries=new Map<string,string>();
const mockClose=jest.fn(async()=>{}), mockDelete=jest.fn(async(_name:string)=>{}), mockExec=jest.fn(async()=>{});
jest.mock('expo-crypto',()=>({randomUUID:()=> '00000000-0000-0000-0000-000000000001',getRandomBytes:()=>new Uint8Array(32).fill(1)}));
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn(async()=>null),setItemAsync:jest.fn(async()=>{}),deleteItemAsync:jest.fn(async()=>{})}));
jest.mock('expo-sqlite',()=>({
 openDatabaseAsync:async(name:string)=>({
  closeAsync:mockClose,execAsync:mockExec,
  getFirstAsync:async(sql:string,key:string)=>sql.includes('cipher_version')?(name.includes('unencrypted')?null:{cipher_version:'test'}):mockEntries.has(key)?{state:mockEntries.get(key)}:null,
  runAsync:async(_sql:string,key:string,value:string)=>{mockEntries.set(key,value);},
 }),
 deleteDatabaseAsync:(name:string)=>mockDelete(name),
}));
test('journal round-trips pending work and refuses an unencrypted native build',async()=>{
 const store=healthJournal('journal-user');
 const state={from:'2026-01-01',samples:[],pending:{anchor:'next',hasMore:false,changes:{daily:[],removeDaily:[],weight:[],removeWeight:[]}}};
 await store.write('sleep',state);expect(await store.read('sleep')).toEqual(state);
 expect(mockExec.mock.calls.length).toBeGreaterThan(0);
 await expect(healthJournal('unencrypted').read('sleep')).rejects.toThrow('requires a new iPhone build');
});
test('local data deletion closes/removes account DB and key',async()=>{
 await healthJournal('delete-user').read('steps');
 await deleteHealthJournal('delete-user');
 expect(mockDelete).toHaveBeenCalledWith('health-delete-user.db');
 expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('health-journal-key-delete-user');
});
test('device identity is created in the Keychain when absent',async()=>{
 expect(await getHealthDeviceId()).toBe('00000000-0000-0000-0000-000000000001');
 expect(SecureStore.setItemAsync).toHaveBeenCalledWith('health-device-id','00000000-0000-0000-0000-000000000001');
});
