import { useRef, useState } from 'react';
import type { Player, FactMastery, PerformanceSnapshot, DbConnection } from '../../spacetime';

interface Props {
  players: Player[];
  factMasteries: FactMastery[];
  performanceSnapshots: PerformanceSnapshot[];
  conn: DbConnection | null;
}

export function BackupRestore({ players, factMasteries, performanceSnapshots, conn }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);

  const handleBackup = () => {
    try {
      const backup = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        server: 'admin-export',
        tables: {
          player: players,
          fact_mastery: factMasteries,
          performance_snapshot: performanceSnapshots,
        },
        counts: {
          player: players.length,
          fact_mastery: factMasteries.length,
          performance_snapshot: performanceSnapshots.length,
        }
      };

      // Convert to JSON (handle BigInt by converting to string)
      const jsonString = JSON.stringify(backup, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      , 2);
      
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mathraiders-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);

      alert(`✅ Backup exported: ${players.length} players, ${factMasteries.length} facts, ${performanceSnapshots.length} snapshots`);
    } catch (err) {
      alert(`❌ Backup failed: ${err}`);
    }
  };

  const handleRestore = async (file: File) => {
    if (!conn) {
      alert('❌ Not connected to SpacetimeDB');
      return;
    }

    if (!confirm('⚠️ RESTORE DATA?\n\nThis will ADD/UPDATE records from the backup file.\nExisting records with matching IDs will be overwritten.\n\nContinue?')) {
      return;
    }

    setRestoring(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup.tables) {
        throw new Error('Invalid backup format: missing tables');
      }

      const results: string[] = [];

      // Restore players
      if (backup.tables.player && backup.tables.player.length > 0) {
        const playerJson = JSON.stringify(backup.tables.player);
        conn.reducers.bulkRestorePlayer({ jsonData: playerJson });
        results.push(`${backup.tables.player.length} players`);
      }

      // Restore fact mastery
      if (backup.tables.fact_mastery && backup.tables.fact_mastery.length > 0) {
        const factMasteryJson = JSON.stringify(backup.tables.fact_mastery);
        conn.reducers.bulkRestoreFactMastery({ jsonData: factMasteryJson });
        results.push(`${backup.tables.fact_mastery.length} fact mastery records`);
      }

      // Restore performance snapshots
      if (backup.tables.performance_snapshot && backup.tables.performance_snapshot.length > 0) {
        const snapshotJson = JSON.stringify(backup.tables.performance_snapshot);
        conn.reducers.bulkRestorePerformanceSnapshot({ jsonData: snapshotJson });
        results.push(`${backup.tables.performance_snapshot.length} snapshots`);
      }

      alert(`✅ Restore initiated:\n${results.join('\n')}\n\nNote: Reducers run async. Refresh to see updated data.`);
    } catch (err) {
      alert(`❌ Restore failed: ${err}`);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-lg p-6 mb-6">
      <h2 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wide">
        Backup / Restore
      </h2>

      <div className="flex gap-4">
        <button
          onClick={handleBackup}
          className="bg-blue-500 hover:bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium cursor-pointer transition-colors"
        >
          📦 Export Backup
        </button>

        <input
          type="file"
          ref={fileInputRef}
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              handleRestore(file);
            }
            e.target.value = '';
          }}
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!conn || restoring}
          className={`${conn && !restoring ? 'bg-amber-500 hover:bg-amber-600 cursor-pointer' : 'bg-slate-500 opacity-50 cursor-not-allowed'} text-white rounded-md px-4 py-2 text-sm font-medium transition-colors`}
        >
          {restoring ? '⏳ Restoring...' : '📥 Restore Backup'}
        </button>
      </div>

      <div className="mt-3 text-xs text-slate-500">
        Backup exports: {players.length} players, {factMasteries.length} fact mastery records, {performanceSnapshots.length} snapshots
      </div>
    </div>
  );
}
