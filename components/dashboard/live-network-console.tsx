'use client';

import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  memo,
} from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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

type SortField =
  | 'ssid'
  | 'signal'
  | 'channel'
  | 'clients'
  | 'classification';

function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/* ----------------------------- UPTIME CELL ----------------------------- */
/* هذا فقط يتحدث كل ثانية بدل الصفحة كلها */

const UptimeCell = memo(function UptimeCell({
  baseSeconds,
}: {
  baseSeconds: number;
}) {
  const [seconds, setSeconds] = useState(baseSeconds);

  useEffect(() => {
    setSeconds(baseSeconds);
  }, [baseSeconds]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return (
    <span className="inline-block min-w-[110px] font-mono tabular-nums">
      {d > 0 ? `${d}d ` : ''}
      {String(h).padStart(2, '0')}:
      {String(m).padStart(2, '0')}:
      {String(s).padStart(2, '0')}
    </span>
  );
});

/* ----------------------------- TABLE ROW ----------------------------- */

const NetworkRow = memo(function NetworkRow({
  network,
}: {
  network: LiveNetworkEvent;
}) {
  return (
    <tr className="border-b border-slate-800 hover:bg-slate-900 transition">
      <td className="px-3 py-3 font-medium">
        {network.ssid || 'Hidden'}
      </td>

      <td className="px-3 py-3 font-mono text-xs">
        {network.bssid}
      </td>

      <td className="px-3 py-3">
        {network.signal ?? '--'} dBm
      </td>

      <td className="px-3 py-3">
        {network.channel ?? '--'}
      </td>

      <td className="px-3 py-3">
        {network.clients_count ?? 0}
      </td>

      <td className="px-3 py-3">
        <UptimeCell
          baseSeconds={Number(network.uptime) || 0}
        />
      </td>

      <td className="px-3 py-3">
        {network.classification || 'LEGIT'}
      </td>
    </tr>
  );
});

/* ----------------------------- MAIN COMPONENT ----------------------------- */

export function LiveNetworkConsole() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);

  const [sortField, setSortField] =
    useState<SortField>('signal');

  const [networks, setNetworks] = useState<
    LiveNetworkEvent[]
  >([]);

  /* ------------------- دمج البيانات الجديدة بدون رعشة ------------------- */

  const mergeNetworks = useCallback(
    (incoming: LiveNetworkEvent[]) => {
      setNetworks((prev) => {
        const map = new Map(
          prev.map((item) => [item.bssid, item])
        );

        incoming.forEach((item) => {
          map.set(item.bssid, {
            ...map.get(item.bssid),
            ...item,
          });
        });

        return Array.from(map.values());
      });
    },
    []
  );

  /* ---------------------- مثال WebSocket / API ---------------------- */

  useEffect(() => {
    // ضع هنا websocket الحقيقي

    const fakeTimer = setInterval(() => {
      mergeNetworks([
        {
          ssid: 'Home WiFi',
          bssid: 'AA:BB:CC:11:22:33',
          signal: -40,
          channel: 6,
          clients_count: 4,
          uptime: 1200,
          classification: 'LEGIT',
        },
        {
          ssid: 'Cafe',
          bssid: 'DD:EE:FF:44:55:66',
          signal: -71,
          channel: 11,
          clients_count: 2,
          uptime: 550,
          classification: 'SUSPICIOUS',
        },
      ]);
    }, 2000);

    return () => clearInterval(fakeTimer);
  }, [mergeNetworks]);

  /* --------------------------- FILTER + SORT --------------------------- */

  const filteredNetworks = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();

    let list = networks;

    if (q) {
      list = list.filter((item) => {
        return (
          (item.ssid || '')
            .toLowerCase()
            .includes(q) ||
          item.bssid
            .toLowerCase()
            .includes(q)
        );
      });
    }

    const sorted = [...list];

    sorted.sort((a, b) => {
      switch (sortField) {
        case 'ssid':
          return (a.ssid || '').localeCompare(
            b.ssid || ''
          );

        case 'channel':
          return (
            (a.channel || 0) -
            (b.channel || 0)
          );

        case 'clients':
          return (
            (b.clients_count || 0) -
            (a.clients_count || 0)
          );

        case 'classification':
          return (
            a.classification || ''
          ).localeCompare(
            b.classification || ''
          );

        case 'signal':
        default:
          return (
            (b.signal || -999) -
            (a.signal || -999)
          );
      }
    });

    return sorted;
  }, [networks, debouncedSearch, sortField]);

  /* ----------------------------- UI ----------------------------- */

  return (
    <Card className="border-none shadow-none">
      <CardContent className="space-y-4 p-4">

        {/* TOP BAR */}
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">

          <h2 className="text-xl font-bold text-emerald-500">
            Live Network Console
          </h2>

          <Input
            placeholder="Search SSID / BSSID"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            className="max-w-sm"
          />
        </div>

        {/* SORT BUTTONS */}
        <div className="flex flex-wrap gap-2">
          {[
            'signal',
            'ssid',
            'channel',
            'clients',
            'classification',
          ].map((field) => (
            <button
              key={field}
              onClick={() =>
                setSortField(
                  field as SortField
                )
              }
              className={`px-3 py-1 rounded text-sm border ${
                sortField === field
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-900'
              }`}
            >
              {field}
            </button>
          ))}
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900">
              <tr>
                <th className="px-3 py-3 text-left">
                  SSID
                </th>

                <th className="px-3 py-3 text-left">
                  BSSID
                </th>

                <th className="px-3 py-3 text-left">
                  Signal
                </th>

                <th className="px-3 py-3 text-left">
                  CH
                </th>

                <th className="px-3 py-3 text-left">
                  Clients
                </th>

                <th className="px-3 py-3 text-left">
                  Uptime
                </th>

                <th className="px-3 py-3 text-left">
                  Class
                </th>
              </tr>
            </thead>

            <tbody>
              {filteredNetworks.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-slate-400"
                  >
                    No Networks Found
                  </td>
                </tr>
              ) : (
                filteredNetworks.map((network) => (
                  <NetworkRow
                    key={network.bssid}
                    network={network}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}