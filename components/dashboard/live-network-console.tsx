'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useTheme } from 'next-themes';
import { Activity, ArrowUpDown, Clock, Search, Server, Shield, Wifi, Users, Lock, Unlock, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useSocket,
  type AttackAckEvent,
  type AttackCommandAckEvent,
  type AttackCommandEvent,
  type SensorStatusEvent,
} from '@/hooks/use-socket';

export interface LiveNetworkEvent {
  ssid?: string;
  bssid: string;
  classification?: 'ROGUE' | 'SUSPICIOUS' | 'LEGIT' | string;
  sensor_id?: number;
  channel?: number | null;
  frequency?: number | null;
  signal?: number | null;
  last_seen?: string;
  distance?: string | null;
  auth?: string | null;
  wps?: string | null;
  encryption?: string | null;
  uptime?: string | null;
  clients_count?: number | null;
  manufacturer?: string | null;
}

type SortField = 'ssid' | 'bssid' | 'signal' | 'classification' | 'uptime' | 'channel' | 'clients';
type SortDirection = 'asc' | 'desc';

interface TelemetryData { sensorStatus: 'online' | 'offline' | 'warning'; backendStatus: 'connected' | 'disconnected' | 'error'; discoveredNetworks: number; activeAttacks: number; lastUpdate: string; }

function estimateDistance(signal: number | null | undefined): string {
  if (!signal || signal === 0 || signal === -999) return '--';
  if (signal >= -40) return '~ 1m';
  if (signal >= -55) return '~ 3m';
  if (signal >= -65) return '~ 7m';
  if (signal >= -75) return '~ 15m';
  if (signal >= -85) return '~ 25m';
  return '30m+';
}

function RouterUptimeValue({ totalSeconds }: { totalSeconds: number }) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return <span>--</span>;

  const normalized = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(normalized / 86400);
  const h = Math.floor((normalized % 86400) / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  const s = Math.floor(normalized % 60);
  const parts = [
    d > 0 ? `${d}d` : null,
    h > 0 ? `${h}h` : null,
    m > 0 ? `${m}m` : null,
    `${s.toString().padStart(2, '0')}s`,
  ].filter(Boolean);

  return (
    <span className="inline-flex min-w-[11ch] justify-start gap-[0.55ch] whitespace-nowrap font-mono tabular-nums leading-none">
      {parts.map((part, index) => (
        <span key={index} className="inline-block min-w-[2.7ch] text-left">
          {part}
        </span>
      ))}
    </span>
  );
}

function classificationClasses(classification?: string) {
  const cls = (classification || '').toUpperCase();
  if (cls === 'ROGUE') return 'bg-red-950/40 text-red-400 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]';
  if (cls === 'SUSPICIOUS') return 'bg-amber-950/40 text-amber-400 border border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]';
  return 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]';
}

function TelemetryStatusBadge({ status, icon, label }: { status: string; icon: React.ReactNode; label: string }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': case 'connected': return 'text-emerald-400 bg-emerald-950/50 border-emerald-700/50';
      case 'offline': case 'disconnected': return 'text-red-400 bg-red-950/50 border-red-700/50';
      case 'warning': case 'error': return 'text-amber-400 bg-amber-950/50 border-amber-700/50';
      default: return 'text-slate-400 bg-slate-950/50 border-slate-700/50';
    }
  };
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${getStatusColor(status)}`}>
      {icon}<span>{label}</span>
    </div>
  );
}

function normalizeNetwork(network: any): LiveNetworkEvent {
  return {
    ...network,
    bssid: String(network.bssid || '').toUpperCase(),
    classification: network.classification || 'LEGIT',
    sensor_id: network.sensor_id || 0,
    channel: network.channel || 0,
    signal: network.signal || 0,
    last_seen: network.last_seen || network.timestamp || new Date().toISOString(),
    distance: network.distance && network.distance !== 'Unknown' ? String(network.distance) : null,
    auth: network.auth && network.auth !== 'Unknown' && network.auth !== 'None' ? String(network.auth) : null,
    wps: network.wps && network.wps !== 'Unknown' && network.wps !== 'None' ? String(network.wps) : null,
    encryption: network.encryption && network.encryption !== 'Unknown' ? String(network.encryption) : null,
    uptime: network.uptime && network.uptime !== 'Unknown' ? String(network.uptime) : null,
    clients_count: Number(network.clients_count || network.clients || 0),
    manufacturer: network.manufacturer && network.manufacturer !== 'Unknown Mfr' && network.manufacturer !== 'Unknown' ? String(network.manufacturer) : null,
  };
}

export function LiveNetworkConsole() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [networksMap, setNetworksMap] = useState<Map<string, LiveNetworkEvent>>(new Map());
  const [sensorStatuses, setSensorStatuses] = useState<SensorStatusEvent[]>([]);
  const [hasNetworkSnapshot, setHasNetworkSnapshot] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [attackState, setAttackState] = useState<string | null>(null);
  const [trustingBssids, setTrustingBssids] = useState<Set<string>>(new Set());

  useEffect(() => {
    setIsSearching(true);
    const timer = setTimeout(() => { setDebouncedSearchQuery(searchQuery); setIsSearching(false); }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  
  const [sortField, setSortField] = useState<SortField>('ssid');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    sensorStatus: 'offline', backendStatus: 'disconnected', discoveredNetworks: 0, activeAttacks: 0, lastUpdate: new Date().toISOString()
  });

  // درع بيسجل حالة السينسور بشكل فوري عشان نقدر نستخدمه جوه السوكيت ونعمل بلوك للبيانات
  const isOfflineRef = useRef(false);
  useEffect(() => {
    isOfflineRef.current = telemetry.sensorStatus === 'offline';
  }, [telemetry.sensorStatus]);

  const apiBase = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000').replace(/\/$/, '');

  const updateTelemetry = useCallback((currentMap: Map<string, LiveNetworkEvent>) => {
    const onlineSensors = sensorStatuses.filter(s => s.status === 'online').length;
    const totalSensors = sensorStatuses.length;
    let sensorStatus: 'online' | 'offline' | 'warning' = 'offline';
    if (onlineSensors === totalSensors && totalSensors > 0) sensorStatus = 'online';
    else if (onlineSensors > 0) sensorStatus = 'warning';

    const activeAttacks = Array.from(currentMap.values()).filter(n => n.classification === 'ROGUE').length;
    setTelemetry({ sensorStatus, backendStatus: 'connected', discoveredNetworks: currentMap.size, activeAttacks, lastUpdate: new Date().toISOString() });
  }, [sensorStatuses]);

  const mergeIncomingNetworks = useCallback((incoming: any[]) => {
    // 🛑 تفعيل الدرع: لو الكارت مفصول، ارفض تستقبل أي شبكات (عشان متظهرش أشباح الشبكات القديمة)
    if (isOfflineRef.current) return;

    setNetworksMap(prevMap => {
      const newMap = new Map(prevMap);
      incoming.forEach(rawNet => {
        const norm = normalizeNetwork(rawNet);
        const existing = newMap.get(norm.bssid);
        
        if (existing) {
          newMap.set(norm.bssid, {
            ...existing,
            ...norm,
            classification: norm.classification, 
            manufacturer: norm.manufacturer || existing.manufacturer,
            channel: (norm.channel && norm.channel !== 0) ? norm.channel : existing.channel,
            wps: norm.wps || existing.wps,
            auth: norm.auth || existing.auth,
            encryption: norm.encryption || existing.encryption,
            uptime: norm.uptime || existing.uptime,
            clients_count: Math.max(norm.clients_count || 0, existing.clients_count || 0),
            signal: (norm.signal && norm.signal !== 0) ? norm.signal : existing.signal,
          });
        } else {
          newMap.set(norm.bssid, norm);
        }
      });
      updateTelemetry(newMap);
      return newMap;
    });
    setHasNetworkSnapshot(true);
  }, [updateTelemetry]);

  const upsertSensorStatus = useCallback((incoming: any) => {
    // الكشف الذكي عن الأعطال للداشبورد
    const msg = (incoming.message || "").toLowerCase();
    const isHardwareOffline = 
      msg.includes("disconnected") || msg.includes("removed") || msg.includes("error") || 
      msg.includes("lost") || msg.includes("down") || msg.includes("no such device") || 
      msg.includes("errno 19") || (incoming.sensor_status || "").toLowerCase() === "error";
      
    const resolvedStatus = isHardwareOffline 
      ? "offline" 
      : (["monitoring", "online", "starting"].includes((incoming.status || incoming.sensor_status || "offline").toLowerCase()) ? "online" : "offline");

    const normalizedIncoming: SensorStatusEvent = {
      ...incoming,
      status: resolvedStatus,
      connected: resolvedStatus === "online",
      last_seen: incoming.last_seen || incoming.last_heartbeat || new Date().toISOString(),
      last_heartbeat: incoming.last_heartbeat || incoming.last_seen || new Date().toISOString(),
    };

    setSensorStatuses((prev) => {
      const index = prev.findIndex((sensor) => sensor.sensor_id === normalizedIncoming.sensor_id);
      if (index === -1) {
        return [...prev, normalizedIncoming];
      }

      const next = [...prev];
      next[index] = {
        ...next[index],
        ...normalizedIncoming,
      };
      return next;
    });
  }, []);

  const { sendAttackCommand } = useSocket({
    onNetworkSnapshot: (event) => { mergeIncomingNetworks(event.data || []); },
    onSensorSnapshot: (event) => {
      setSensorStatuses(
        (event.data || []).map((s: any) => {
          // الكشف الذكي عن الأعطال وقت الـ Snapshot
          const msg = (s.message || "").toLowerCase();
          const isHardwareOffline = 
            msg.includes("disconnected") || msg.includes("removed") || msg.includes("error") || 
            msg.includes("lost") || msg.includes("down") || msg.includes("no such device") || 
            msg.includes("errno 19") || (s.sensor_status || "").toLowerCase() === "error";
            
          const resolvedStatus = isHardwareOffline 
            ? "offline" 
            : (["monitoring", "online", "starting"].includes((s.status || s.sensor_status || "offline").toLowerCase()) ? "online" : "offline");

          return {
            ...s,
            status: resolvedStatus,
            connected: resolvedStatus === "online",
            last_seen: s.last_seen || s.last_heartbeat || new Date().toISOString(),
            last_heartbeat: s.last_heartbeat || s.last_seen || new Date().toISOString(),
          };
        }),
      );
    },
    onSensorStatusUpdate: (event) => {
      if (!event?.data?.sensor_id) return;
      upsertSensorStatus(event.data);
    },
    onNetworkRemoved: (event) => {
      const bssid = String(event.bssid || '').toUpperCase();
      setNetworksMap(prev => { const m = new Map(prev); m.delete(bssid); return m; });
    },
    onAttackCommandAck: (event) => {
      if (event.status === 'ok') setAttackState(`Dispatch confirmed for ${event.bssid}`);
      else { setAttackState(`Rejected: ${event.message}`); toast.error('Attack Rejected', { description: event.message }); }
    },
    onAttackAck: (event) => {
      setAttackState(`Attack ${event.status}: ${event.bssid}`);
      if (event.status === 'executed') toast.success('Attacking', { description: `Sensor confirmed ${event.bssid}` });
      else toast.error('Failed', { description: event.message });
    },
  });

  useEffect(() => {
    updateTelemetry(networksMap);
  }, [sensorStatuses, networksMap, updateTelemetry]);

  // تأثير جديد: تفريغ خريطة الشبكات بعد ثانية واحدة بالظبط من فصل الكارت
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    // لو حالة السينسور بقت أوفلاين (بسبب إن الكارت اتشال)
    if (telemetry.sensorStatus === 'offline') {
      timeoutId = setTimeout(() => {
        setNetworksMap(new Map()); // مسح كل الشبكات من الشاشة فوراً
      }, 1000); // الانتظار لمدة 1 ثانية (1000 ملي ثانية)
    }
    
    // تنظيف: لو الكارت رجع فجأة قبل ما الثانية تخلص، نلغي أمر المسح
    return () => clearTimeout(timeoutId);
  }, [telemetry.sensorStatus]);

  const loading = !hasNetworkSnapshot;

  useEffect(() => {
    let cancelled = false;
    const fetchActive = async () => {
      try {
        const res = await fetch(`${apiBase}/networks/active`, { cache: 'no-store' });
        if (!res.ok) return;
        const payload = await res.json();
        if (!cancelled && Array.isArray(payload.networks)) mergeIncomingNetworks(payload.networks);
      } catch (e) {}
    };
    fetchActive();
    return () => { cancelled = true; };
  }, [apiBase, mergeIncomingNetworks]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };

  const parseLastSeenMs = useCallback((rawValue?: string) => {
    if (!rawValue) return NaN;
    const ms = new Date(rawValue).getTime();
    return Number.isNaN(ms) ? NaN : ms;
  }, []);

  const computeRollingUptimeSeconds = useCallback((network: LiveNetworkEvent) => {
    const baseUptimeSeconds = Number(network.uptime);
    if (!Number.isFinite(baseUptimeSeconds) || baseUptimeSeconds <= 0) return 0;
    const lastSeenMs = parseLastSeenMs(network.last_seen);
    const elapsedSeconds = Number.isNaN(lastSeenMs) ? 0 : Math.max(0, Math.floor((nowMs - lastSeenMs) / 1000));
    return Math.max(0, Math.floor(baseUptimeSeconds) + elapsedSeconds);
  }, [nowMs, parseLastSeenMs]);

  const networkList = useMemo(() => {
    let list = Array.from(networksMap.values()).map(n => {
      return { ...n, distance: estimateDistance(n.signal) };
    });

    if (debouncedSearchQuery) {
      const query = debouncedSearchQuery.toLowerCase().trim();
      list = list.filter((n) => (n.ssid || '').toLowerCase().includes(query) || n.bssid.replace(/[:-]/g, '').toLowerCase().includes(query.replace(/[:-]/g, '')));
    }

    return list.sort((left, right) => {
      let comparison = 0;
      switch (sortField) {
        case 'ssid': comparison = (left.ssid || 'Hidden').localeCompare(right.ssid || 'Hidden'); break;
        case 'bssid': comparison = left.bssid.localeCompare(right.bssid); break;
        case 'signal': comparison = (right.signal ?? -999) - (left.signal ?? -999); break;
        case 'classification': comparison = (left.classification || '').localeCompare(right.classification || ''); break;
        case 'uptime': comparison = computeRollingUptimeSeconds(left) - computeRollingUptimeSeconds(right); break;
        case 'channel': comparison = (left.channel ?? 0) - (right.channel ?? 0); break;
        case 'clients': comparison = (left.clients_count ?? 0) - (right.clients_count ?? 0); break;
      }
      if (comparison === 0) return left.bssid.localeCompare(right.bssid);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [networksMap, sortField, sortDirection, debouncedSearchQuery, computeRollingUptimeSeconds]);

  const handleAttack = (network: LiveNetworkEvent) => {
    try { sendAttackCommand({ sensor_id: network.sensor_id || 0, bssid: network.bssid }); setAttackState(`Dispatching deauth for ${network.bssid}`); } 
    catch (error) { toast.error('Attack failed', { description: 'Network issue' }); }
  };

  const handleTrust = async (network: LiveNetworkEvent) => {
     const bssid = network.bssid;
     setTrustingBssids(prev => new Set(prev).add(bssid));
     try {
       const response = await fetch(`${apiBase}/trust`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ bssid, ssid: network.ssid || 'Hidden' }),
       });
       if (!response.ok) throw new Error('Failed to trust network');
       toast.success('Network Trusted', { description: `${bssid} added to trusted whitelist.` });
     } catch (error) {
       toast.error('Whitelist Failed', { description: error instanceof Error ? error.message : 'Network issue' });
     } finally {
       setTrustingBssids(prev => {
         const next = new Set(prev);
         next.delete(bssid);
         return next;
       });
     }
  };

  return (
    <div className="space-y-6 mt-2">
      {attackState && (
        <Card className="border-emerald-500/20 bg-emerald-950/10 shadow-[0_0_15px_rgba(16,185,129,0.05)]">
          <CardContent className="pt-6 text-sm text-emerald-400 font-medium animate-pulse"><span className="mr-2">⚡</span> {attackState}</CardContent>
        </Card>
      )}

      <Card className="bg-slate-900 overflow-hidden border-none shadow-none py-0">
          <CardHeader className="p-0 border-none bg-transparent">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 w-full">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 flex-1 w-full">
                <CardTitle className="text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.7)] text-xl font-bold tracking-tight whitespace-nowrap">ZeinaGuard</CardTitle>
                <div className="relative w-full flex-1">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    {isSearching ? <Loader2 className="h-4 w-4 text-emerald-500 animate-spin" /> : <Search className="h-4 w-4 text-emerald-500/70" />}
                  </div>
                  <Input type="text" placeholder="Search SSID or MAC address" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-10 pl-10 pr-10 w-full bg-emerald-950/20 border-emerald-500/30 text-emerald-50 placeholder:text-emerald-500/40 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.1)] outline-none" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                <TelemetryStatusBadge status={telemetry.sensorStatus} icon={<Shield className="w-3.5 h-3.5 drop-shadow-[0_0_3px_rgba(52,211,153,0.5)]" />} label={`Sensor ${telemetry.sensorStatus}`} />
                <TelemetryStatusBadge status={telemetry.backendStatus} icon={<Server className="w-3.5 h-3.5 drop-shadow-[0_0_3px_rgba(52,211,153,0.5)]" />} label={`Backend ${telemetry.backendStatus}`} />
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-emerald-500/20 bg-emerald-950/20 text-emerald-400/90 text-xs font-medium shadow-[0_0_8px_rgba(16,185,129,0.05)]"><Wifi className="w-3.5 h-3.5 text-emerald-500 drop-shadow-[0_0_3px_rgba(16,185,129,0.5)]" /><span>{telemetry.discoveredNetworks} Networks</span></div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-emerald-500/20 bg-emerald-950/20 text-emerald-400/90 text-xs font-medium shadow-[0_0_8px_rgba(16,185,129,0.05)]"><Clock className="w-3.5 h-3.5 text-emerald-500 drop-shadow-[0_0_3px_rgba(16,185,129,0.5)]" /><span>{mounted ? new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--:--'} Local</span></div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-0">
            {loading ? (
              <div className="flex h-64 items-center justify-center text-emerald-500/50"><Activity className="mr-2 h-5 w-5 animate-spin" />Initializing Neon Grid...</div>
            ) : (
              <div className="overflow-x-auto border border-emerald-500/10 bg-slate-900/80 backdrop-blur-md rounded-lg shadow-[0_0_30px_rgba(0,0,0,0.4)]">
                <div className="w-full">
                  <table className="hidden lg:table w-full">
                    <thead>
                      <tr className="border-b border-emerald-500/20 bg-emerald-950/10 backdrop-blur-sm">
                        <th className="px-3 py-3 text-left"><button onClick={() => handleSort('ssid')} className="flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300">WiFi <ArrowUpDown className="h-3 w-3" /></button></th>
                        <th className="px-3 py-3 text-left"><button onClick={() => handleSort('channel')} className="flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300">CH <ArrowUpDown className="h-3 w-3" /></button></th>
                        <th className="px-3 py-3 text-left"><button onClick={() => handleSort('signal')} className="flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300">Signal / Dist <ArrowUpDown className="h-3 w-3" /></button></th>
                        <th className="px-3 py-3 text-left"><span className="flex items-center gap-2 text-sm font-semibold text-emerald-400">Security</span></th>
                        <th className="px-3 py-3 text-left"><button onClick={() => handleSort('clients')} className="flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300">Clients <ArrowUpDown className="h-3 w-3" /></button></th>
                        <th className="px-3 py-3 text-left w-[120px]"><button onClick={() => handleSort('uptime')} className="flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300">UpTime <ArrowUpDown className="h-3 w-3" /></button></th>
                        <th className="px-3 py-3 text-left"><button onClick={() => handleSort('classification')} className="flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300">Class <ArrowUpDown className="h-3 w-3" /></button></th>
                        <th className="px-3 py-3 text-center text-emerald-400 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {networkList.map((network, index) => {
                        const wpsValue = network.wps || '';
                        const isWpsActive = wpsValue.toUpperCase().includes('ACTIVE') || wpsValue.toUpperCase().includes('V1');
                        const hasClients = (network.clients_count || 0) > 0;
                        const mfrValue = network.manufacturer;
                        const authValue = network.auth || network.encryption || 'Unknown';
                        const isTrusted = (network.classification || '').toUpperCase() === 'LEGIT';
                        const isTrusting = trustingBssids.has(network.bssid);

                        return (
                        <tr key={network.bssid} className={`border-b border-emerald-500/5 hover:bg-emerald-500/5 transition-all duration-200 ${index % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-800/20'}`}>
                          <td className="px-3 py-4">
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-emerald-50 text-base truncate drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]">{network.ssid || 'Hidden'}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <div className="font-mono text-[11px] text-emerald-400/70 tracking-widest bg-emerald-500/5 px-1 py-0.5 rounded border border-emerald-500/10">{network.bssid}</div>
                                {mfrValue && <span className="text-[10px] text-slate-400/90 bg-slate-800/60 px-1.5 py-0.5 rounded truncate max-w-[120px] border border-slate-700/50" title={mfrValue}>{mfrValue}</span>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-4">
                             <div className="font-bold text-emerald-100/90 text-sm bg-slate-800/50 px-2 py-1 rounded border border-slate-700/50 inline-block">
                                {network.channel && network.channel !== 0 ? network.channel : '--'}
                             </div>
                          </td>
                          <td className="px-3 py-4">
                            <div className="flex flex-col gap-1">
                              <div className={`text-base font-medium ${(network.signal || -999) > -60 ? 'text-emerald-400' : (network.signal || -999) > -75 ? 'text-amber-400' : network.signal && network.signal !== 0 ? 'text-red-400' : 'text-emerald-500/50'}`}>
                                {network.signal && network.signal !== 0 ? `${network.signal} dBm` : '--'}
                              </div>
                              <div className="text-xs text-slate-400 font-mono">{network.distance || '--'}</div>
                            </div>
                          </td>
                          <td className="px-3 py-4">
                             <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  {authValue === 'OPEN' ? <Unlock className="w-3 h-3 text-red-400" /> : <Lock className="w-3 h-3 text-emerald-400" />}
                                  <span className={`text-xs font-semibold ${authValue === 'OPEN' ? 'text-red-400' : 'text-emerald-100'}`}>{authValue}</span>
                                </div>
                                {wpsValue && wpsValue !== 'Disabled' && (
                                  <div className="text-[10px] uppercase font-bold tracking-wider">
                                    <span className="text-slate-500">WPS: </span><span className={isWpsActive ? 'text-amber-500' : 'text-emerald-500'}>ON</span>
                                  </div>
                                )}
                             </div>
                          </td>
                          <td className="px-3 py-4">
                             <div className="flex items-center gap-1.5 bg-slate-800/40 px-2 py-1 rounded-md border border-slate-700/30 w-fit">
                                <Users className={`w-4 h-4 ${hasClients ? 'text-blue-400' : 'text-slate-500'}`} />
                                <span className={`font-bold text-sm ${hasClients ? 'text-emerald-50' : 'text-slate-400'}`}>{network.clients_count || 0}</span>
                             </div>
                          </td>
                          <td className="px-3 py-4 w-[120px]">
                            <div className="text-sm text-emerald-100/70">
                              <RouterUptimeValue totalSeconds={computeRollingUptimeSeconds(network)} />
                            </div>
                          </td>
                          <td className="px-3 py-4">
                          <span className={`rounded-full px-3 py-1 text-sm font-semibold shadow-sm ${classificationClasses(network.classification)}`}>{network.classification || 'LEGIT'}</span>
                          </td>
                          <td className="px-3 py-4">
                             <div className="flex items-center justify-center gap-2">
                                <Button type="button" size="sm" className="bg-transparent border border-red-500/40 text-red-500 hover:bg-red-500/20 transition-all duration-300 shadow-sm font-bold" onClick={() => handleAttack(network)}>
                                  Attack
                                </Button>
                                <Button type="button" size="sm" className="bg-transparent border border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-50 transition-all duration-300 shadow-sm px-2" onClick={() => handleTrust(network)} title="Mark as Trusted" aria-label={`Mark ${network.bssid} as trusted`} disabled={isTrusted || isTrusting}>
                                  {isTrusting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                </Button>
                             </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  );
}
