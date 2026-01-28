import { useState } from 'react';
import type { Player, DbConnection } from '../../spacetime';

function getDisplayName(player: { name?: string | null; email?: string | null }): string {
  if (!player.name) return 'Unknown';
  if (player.name.startsWith('Player') && player.email) {
    const emailName = player.email.split('@')[0];
    const parts = emailName.split('.');
    const firstName = parts[0];
    return firstName.charAt(0).toUpperCase() + firstName.slice(1);
  }
  return player.name;
}

interface Props {
  players: Player[];
  conn: DbConnection | null;
}

export function AdminActions({ players, conn }: Props) {
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('0');

  const handleChangeGrade = () => {
    if (!selectedPlayer || !conn) return;
    const player = players.find((p) => p.id === selectedPlayer);
    if (!player) return;

    const displayName = getDisplayName(player);
    if (!confirm(`Change ${displayName}'s grade from ${player.grade} to ${selectedGrade}?`)) return;

    try {
      conn.reducers.setGrade({ grade: parseInt(selectedGrade), playerId: selectedPlayer });
      alert(`✅ Changed ${displayName} to Grade ${selectedGrade}`);
    } catch (err) {
      alert(`❌ Failed: ${err}`);
    }
  };

  const handleResetPlayer = () => {
    if (!selectedPlayer || !conn) return;
    const player = players.find((p) => p.id === selectedPlayer);
    if (!player) return;

    const displayName = getDisplayName(player);
    if (!confirm(`⚠️ RESET ALL PROGRESS for ${displayName}?\n\nThis will:\n- Delete all raid history\n- Delete all fact mastery\n- Reset stats to zero\n\nThis cannot be undone!`)) return;

    try {
      conn.reducers.adminResetPlayer({ playerId: selectedPlayer });
      alert(`✅ Reset ${displayName} - all progress cleared`);
    } catch (err) {
      alert(`❌ Failed: ${err}`);
    }
  };

  // Sort players alphabetically by display name
  const sortedPlayers = [...players]
    .filter((p) => p.id != null && p.name)
    .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));

  return (
    <div className="bg-slate-800 rounded-lg p-6 mb-6">
      <h2 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wide">
        Admin Actions
      </h2>

      <div className="flex gap-4 items-center flex-wrap">
        <select
          value={selectedPlayer}
          onChange={(e) => setSelectedPlayer(e.target.value)}
          className="bg-slate-900 text-slate-200 border border-slate-700 rounded-md px-4 py-2 text-sm min-w-[350px]"
        >
          <option value="">Select player...</option>
          {sortedPlayers.map((p) => {
            const displayName = getDisplayName(p);
            return (
              <option key={String(p.id)} value={p.id}>
                {displayName} (G{p.grade}, {p.rank || 'unranked'}){p.email ? ` - ${p.email}` : ''}
              </option>
            );
          })}
        </select>

        <select
          value={selectedGrade}
          onChange={(e) => setSelectedGrade(e.target.value)}
          className="bg-slate-900 text-slate-200 border border-slate-700 rounded-md px-4 py-2 text-sm"
        >
          <option value="0">Grade K</option>
          <option value="1">Grade 1</option>
          <option value="2">Grade 2</option>
          <option value="3">Grade 3</option>
          <option value="4">Grade 4</option>
          <option value="5">Grade 5</option>
        </select>

        <button
          onClick={handleChangeGrade}
          disabled={!selectedPlayer}
          className={`bg-blue-500 text-white rounded-md px-4 py-2 text-sm font-medium transition-colors ${selectedPlayer ? 'hover:bg-blue-600 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
        >
          Change Grade
        </button>

        <button
          onClick={handleResetPlayer}
          disabled={!selectedPlayer}
          className={`bg-red-500 text-white rounded-md px-4 py-2 text-sm font-medium transition-colors ${selectedPlayer ? 'hover:bg-red-600 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
        >
          Reset Progress
        </button>
      </div>
    </div>
  );
}
