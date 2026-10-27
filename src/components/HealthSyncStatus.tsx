import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { Button, ErrorText, styles } from '@/components/ui';
import { useHealthSync } from '@/lib/health/sync';
import { HEALTH_METRICS, type MetricSyncState } from '@/lib/health/coordinator';
import { useTheme } from '@/theme';

const names={steps:'Steps',sleep:'Sleep',weight:'Weight',workouts:'Workouts'};
export function describeHealthSync(m:MetricSyncState):string {
  switch(m.status){
    case 'syncing':return 'Checking Health…';
    case 'importing':return `Importing history (${m.knownSamples.toLocaleString()} readings checked)…`;
    case 'unavailable':return 'Requires the native iPhone app build.';
    case 'needs-permission':return 'Health access has not been requested.';
    case 'no-data':return 'No readings returned. Access may be limited or nothing was recorded.';
    case 'unchanged':return 'No new Health changes returned. Access may be limited.';
    case 'synced':return 'Import completed.';
    case 'error':return m.error ?? 'Could not sync. Try again.';
    default:return 'Not imported yet.';
  }
}
export function HealthSyncStatus(){
  const t=useTheme(),health=useHealthSync(),router=useRouter();
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  if(Platform.OS==='web')return <View style={{gap:8,marginBottom:16}}>
    <Text style={[styles.heading,{color:t.ink}]}>Apple Health</Text>
    <Text style={[styles.caption,{color:t.inkSoft}]}>Apple Health import is available in the iPhone app.</Text>
  </View>;
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError(null);try{await fn();}catch(e){setError(e instanceof Error?e.message:'Could not connect to Health.');}finally{setBusy(false);}};
  return <View style={{gap:8,marginBottom:16}}>
    <Text style={[styles.heading,{color:t.ink}]}>Apple Health</Text>
    <Text style={[styles.caption,{color:t.inkSoft}]}>{health.connected?'Imports run while you use the app and when you return. Reading access can be limited separately for each metric.':'Connect this account to import steps, sleep summaries, weight readings, and workouts to your private account. Group sharing is controlled separately.'}</Text>
    <ErrorText>{error ?? health.error}</ErrorText>
    {health.connected && HEALTH_METRICS.map((metric)=>{
      const m=health.metrics[metric];
      return <View key={metric} accessibilityLiveRegion="polite">
        <Text style={[styles.body,{color:m.status==='error'?t.danger:t.ink}]}>{names[metric]}: {describeHealthSync(m)}</Text>
        {m.lastSuccess && <Text style={[styles.caption,{color:t.inkSoft}]}>Last completed import: {new Date(m.lastSuccess).toLocaleString()}</Text>}
      </View>;
    })}
    <Button label={health.connected?'Review Health Access':'Connect Apple Health'} busy={busy} disabled={!health.ready || health.syncing} onPress={()=>health.connected?router.push('/steps/permission'):action(health.connect)}/>
    {health.connected && <>
      <Button label={health.syncing?'Importing…':'Refresh Health Data'} secondary disabled={busy || health.syncing} onPress={()=>action(health.sync)}/>
      <Button plain label="Recheck Health History" disabled={busy || health.syncing} onPress={()=>action(health.recheck)}/>
      <Button plain label="Stop Health Imports" disabled={busy} onPress={()=>action(health.disconnect)}/>
    </>}
  </View>;
}
