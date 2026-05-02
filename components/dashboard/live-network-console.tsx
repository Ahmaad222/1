import React, { useEffect, useMemo, useState, useCallback, memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// Optimized version: isolates ticking uptime, memoized rows, stable sorting, throttled updates.

export interface LiveNetworkEvent {
  ssid?: string;
  bssid: string;
  signal?: number | null;
  channel?: number | null;
  classification?: string;
  uptime?: number | string | null;
  last_seen?: string;
  clients_count?: number | null;
}

function useDebounced<T>(value:T, delay=250){
  const [v,setV]=useState(value);
  useEffect(()=>{const t=setTimeout(()=>setV(value),delay);return()=>clearTimeout(t)},[value,delay]);
  return v;
}

const UptimeCell = memo(function UptimeCell({base}:{base:number}){
  const [sec,setSec]=useState(base);
  useEffect(()=>{setSec(base)},[base]);
  useEffect(()=>{const t=setInterval(()=>setSec(s=>s+1),1000);return()=>clearInterval(t)},[]);
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
  return <span className='font-mono tabular-nums inline-block min-w-[90px]'>{h}:{String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}</span>
});

const NetworkRow = memo(function NetworkRow({n}:{n:LiveNetworkEvent}){
  return (
    <tr className='border-b'>
      <td>{n.ssid || 'Hidden'}</td>
      <td className='font-mono'>{n.bssid}</td>
      <td>{n.signal ?? '--'} dBm</td>
      <td>{n.channel ?? '--'}</td>
      <td>{n.clients_count ?? 0}</td>
      <td><UptimeCell base={Number(n.uptime)||0} /></td>
      <td>{n.classification || 'LEGIT'}</td>
    </tr>
  )
});

export default function LiveNetworkConsole(){
  const [query,setQuery]=useState('');
  const debounced=useDebounced(query);
  const [networks,setNetworks]=useState<LiveNetworkEvent[]>([]);

  // Example websocket patching strategy: merge only changed rows
  const mergeNetwork = useCallback((incoming:LiveNetworkEvent[])=>{
    setNetworks(prev=>{
      const map = new Map(prev.map(x=>[x.bssid,x]));
      incoming.forEach(n=> map.set(n.bssid,{...map.get(n.bssid),...n}));
      return Array.from(map.values());
    })
  },[]);

  useEffect(()=>{
    // attach websocket here and call mergeNetwork(payload)
  },[mergeNetwork]);

  const filtered = useMemo(()=>{
    const q = debounced.toLowerCase().trim();
    let list = networks;
    if(q){
      list = list.filter(n => (n.ssid||'').toLowerCase().includes(q) || n.bssid.toLowerCase().includes(q));
    }
    return [...list].sort((a,b)=> (b.signal||-999) - (a.signal||-999));
  },[networks,debounced]);

  return (
    <Card>
      <CardContent className='space-y-4 p-4'>
        <Input value={query} onChange={e=>setQuery(e.target.value)} placeholder='Search SSID or BSSID' />
        <div className='overflow-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr>
                <th>SSID</th><th>BSSID</th><th>Signal</th><th>CH</th><th>Clients</th><th>Uptime</th><th>Class</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(n => <NetworkRow key={n.bssid} n={n} />)}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
