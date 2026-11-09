import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { Button, ErrorText, Row, Section, styles } from '@/components/ui';
import { useHealthSync } from '@/lib/health/sync';
import { healthProviderName } from '@/lib/health-adapter/capabilities';
import { HEALTH_METRICS, type MetricSyncState } from '@/lib/health/coordinator';
import { useTheme } from '@/theme';

const names={steps:'Steps',sleep:'Sleep',weight:'Weight',workouts:'Workouts',water:'Water'};
// Health Connect refused the full import window because history access is off.
const truncation=(from:string)=>`Showing data since ${new Date(from).toLocaleDateString()}; allow access to past data in Health Connect to import more.`;
export function describeHealthSync(m:MetricSyncState):string {
  switch(m.status){
    case 'syncing':return 'Checking Health…';
    case 'importing':return `Importing history (${m.knownSamples.toLocaleString()} readings checked)…`;
    case 'unavailable':return Platform.OS==='android'?'Needs Health Connect and the Leaderboard Android app build. Open Review Health Access for help.':'Requires the native iPhone app build.';
    case 'needs-permission':return 'Health access has not been requested.';
    case 'no-data':return 'No readings returned. Access may be limited or nothing was recorded.';
    case 'unchanged':return m.truncatedFrom?`No new Health changes returned. ${truncation(m.truncatedFrom)}`:'No new Health changes returned. Access may be limited.';
    case 'synced':return m.truncatedFrom?`Import completed. ${truncation(m.truncatedFrom)}`:'Import completed.';
    case 'error':return m.error ?? 'Could not sync. Try again.';
    default:return 'Not imported yet.';
  }
}
// "4 min ago", "3 h ago", or the date, for the one-line status on the Summary.
export function agoLabel(iso:string, now=new Date()):string {
  const min=Math.max(0,Math.round((now.getTime()-Date.parse(iso))/60_000));
  if(min<1)return 'just now';
  if(min<60)return `${min} min ago`;
  if(min<24*60)return `${Math.round(min/60)} h ago`;
  return new Date(iso).toLocaleDateString();
}
const heart={ios:'heart.text.square',android:'favorite',web:'favorite'} as const;

// `summary`: one row on the Summary (connect, or status that opens Health Access). `details`: per-metric import
// status with refresh controls, for the Health Access screen; nothing until connected. Default: the full block.
export function HealthSyncStatus({variant='full'}:{variant?:'summary'|'details'|'full'}){
  const t=useTheme(),health=useHealthSync(),router=useRouter();
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const provider=healthProviderName();
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError(null);try{await fn();}catch(e){setError(e instanceof Error?e.message:'Could not connect to Health.');}finally{setBusy(false);}};
  if(variant==='summary'){
    if(Platform.OS==='web')return <Section><Row icon={heart} label="Apple Health" value="iPhone app only" last /></Section>;
    const states=HEALTH_METRICS.map((m)=>health.metrics[m]);
    const last=states.map((m)=>m.lastSuccess).filter((v): v is string=>!!v).sort().at(-1);
    const value=health.syncing?'Importing…':states.some((m)=>m.status==='error')?'Needs attention':last?`Imported ${agoLabel(last)}`:'Connected';
    return <View style={{gap:8}}>
      <Section>
        {health.connected
          ?<Row icon={heart} label={provider} value={value} last onPress={()=>router.push('/steps/permission')} />
          :<Row icon={heart} label={`Connect ${provider}`} action last disabled={busy || !health.ready} onPress={()=>void action(health.connect)} />}
      </Section>
      <ErrorText>{error ?? health.error}</ErrorText>
    </View>;
  }
  if(variant==='details'){
    if(Platform.OS==='web' || !health.connected)return null;
    return <View style={{gap:8}}>
      <Text accessibilityRole="header" style={[styles.heading,{color:t.ink}]}>Imports</Text>
      <ErrorText>{error ?? health.error}</ErrorText>
      {HEALTH_METRICS.map((metric)=>{
        const m=health.metrics[metric];
        return <View key={metric} accessibilityLiveRegion="polite">
          <Text style={[styles.body,{color:m.status==='error'?t.danger:t.ink}]}>{names[metric]}: {describeHealthSync(m)}</Text>
          {m.lastSuccess && <Text style={[styles.caption,{color:t.inkSoft}]}>Last completed import: {new Date(m.lastSuccess).toLocaleString()}</Text>}
        </View>;
      })}
      <Button label={health.syncing?'Importing…':'Refresh Health Data'} secondary disabled={busy || health.syncing} onPress={()=>action(health.sync)}/>
      <Button plain label="Recheck Health History" disabled={busy || health.syncing} onPress={()=>action(health.recheck)}/>
      <Button plain label="Stop Health Imports" disabled={busy} onPress={()=>action(health.disconnect)}/>
    </View>;
  }
  if(Platform.OS==='web')return <View style={{gap:8,marginBottom:16}}>
    <Text style={[styles.heading,{color:t.ink}]}>Apple Health</Text>
    <Text style={[styles.caption,{color:t.inkSoft}]}>Apple Health import is available in the iPhone app.</Text>
  </View>;
  return <View style={{gap:8,marginBottom:16}}>
    <Text style={[styles.heading,{color:t.ink}]}>{provider}</Text>
    <Text style={[styles.caption,{color:t.inkSoft}]}>{health.connected?'Imports run while you use the app and when you return. Reading access can be limited separately for each metric.':'Connect this account to import steps, sleep summaries, weight readings, workouts, and water to your private account. Group sharing is controlled separately.'}</Text>
    <ErrorText>{error ?? health.error}</ErrorText>
    {health.connected && HEALTH_METRICS.map((metric)=>{
      const m=health.metrics[metric];
      return <View key={metric} accessibilityLiveRegion="polite">
        <Text style={[styles.body,{color:m.status==='error'?t.danger:t.ink}]}>{names[metric]}: {describeHealthSync(m)}</Text>
        {m.lastSuccess && <Text style={[styles.caption,{color:t.inkSoft}]}>Last completed import: {new Date(m.lastSuccess).toLocaleString()}</Text>}
      </View>;
    })}
    <Button label={health.connected?'Review Health Access':`Connect ${provider}`} busy={busy} disabled={!health.ready || health.syncing} onPress={()=>health.connected?router.push('/steps/permission'):action(health.connect)}/>
    {health.connected && <>
      <Button label={health.syncing?'Importing…':'Refresh Health Data'} secondary disabled={busy || health.syncing} onPress={()=>action(health.sync)}/>
      <Button plain label="Recheck Health History" disabled={busy || health.syncing} onPress={()=>action(health.recheck)}/>
      <Button plain label="Stop Health Imports" disabled={busy} onPress={()=>action(health.disconnect)}/>
    </>}
  </View>;
}
