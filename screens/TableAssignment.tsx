
import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal';
import { Header } from '../components/Header';
import { Screen } from '../types';
import { usePos } from '../PosContext';
import { apiFetch } from '../api';

type StaffRow = { id: string; name: string; roleName?: string; roleId?: string; status?: string };

const staffLabel = (s: any) => {
  const name = typeof s?.name === 'string' ? s.name : '';
  const role = typeof s?.roleName === 'string' && s.roleName.trim() ? s.roleName : typeof s?.role === 'string' ? s.role : '';
  const status = typeof s?.status === 'string' ? s.status : '';
  const avatar = typeof s?.avatar === 'string' ? s.avatar : '';
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p: string) => p.slice(0, 1).toUpperCase())
    .join('') || 'W';
  return { name: name || 'Waiter', role: role || 'Waiter', status: status || 'Active', avatar, initials };
};

interface Props {
  onNavigate: (screen: Screen) => void;
}

export const TableAssignment: React.FC<Props> = ({ onNavigate }) => {
  const { tables, addTable, deleteTable, selectTable, setTableAssignment } = usePos();
  const [selectedZone, setSelectedZone] = useState('All Zones');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [selectedTableIds, setSelectedTableIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableSeats, setNewTableSeats] = useState('4');
  const [newTableArea, setNewTableArea] = useState<'Main Hall' | 'Patio' | 'Bar Area' | 'Private Room'>('Main Hall');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string>('');
  const [actionBanner, setActionBanner] = useState('');

  const [remoteStaff, setRemoteStaff] = useState<StaffRow[]>([]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const res = await apiFetch('/api/manager/staff?pageSize=50');
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) return;
        const rows = Array.isArray(json?.staff) ? (json.staff as StaffRow[]) : [];
        if (!mounted) return;
        setRemoteStaff(rows);
        try {
          const cache: Record<string, string> = {};
          for (const r of rows) {
            if (r && typeof r.id === 'string' && typeof r.name === 'string' && r.name.trim()) cache[r.id] = r.name.trim();
          }
          localStorage.setItem('mirachpos.staffNameCache.v1', JSON.stringify(cache));
          window.dispatchEvent(new Event('mirachpos-staff-cache-changed'));
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, []);

  // Filter staff to show relevant roles (Waiters)
  const availableStaff = useMemo(() => {
    const remoteWaiters = remoteStaff.filter((s) => String(s.roleName || '').toLowerCase() === 'waiter');
    return remoteWaiters as any;
  }, [remoteStaff]);

  const staffById = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of remoteStaff) map.set(s.id, { id: s.id, name: s.name });
    return map;
  }, [remoteStaff]);

  const filteredTables = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tables
      .filter((t) => {
        const zone = (t.area ?? 'Main Hall') as string;
        const matchesZone = selectedZone === 'All Zones' || zone === selectedZone;
        const matchesSearch = q.length === 0 ? true : t.name.toLowerCase().includes(q);
        return matchesZone && matchesSearch;
      })
      .map((t) => ({
        id: t.id,
        code: t.name,
        seats: t.seats,
        zone: (t.area ?? 'Main Hall') as string,
        status: t.openOrderId ? 'occupied' : 'available',
        assignedStaffId: t.assignedStaffId ?? null,
      }));
  }, [tables, searchQuery, selectedZone]);

  const selectedStaff = availableStaff.find((s: any) => s.id === selectedStaffId) as any;

  const toggleTableSelection = (id: string) => {
    if (!selectedStaffId) return; // Prevent selection if no staff is chosen first
    
    const newSet = new Set(selectedTableIds);
    if (newSet.has(id)) {
        newSet.delete(id);
    } else {
        newSet.add(id);
    }
    setSelectedTableIds(newSet);
  };

  const openTable = (id: string) => {
    selectTable(id);
    onNavigate(Screen.WAITER_MENU);
  };

  const openWaiterFloor = (staffId: string) => {
    try {
      localStorage.setItem('mirachpos.manager.floor.waiterId', staffId);
      localStorage.removeItem('mirachpos.manager.impersonate.waiterId');
    } catch {
      // ignore
    }
    onNavigate(Screen.MANAGER_FLOOR_MAP);
  };

  const handleStaffSelect = (id: string) => {
      if (selectedStaffId === id) {
          setSelectedStaffId(null);
          setSelectedTableIds(new Set()); // Clear tables if deselecting staff
      } else {
          setSelectedStaffId(id);
          // Optional: If we wanted to preserve table selection when switching staff, we'd remove the clearing logic.
          // But "first choose staff" implies a flow. Let's keep tables selected if they switch staff to make it easy to re-assign.
      }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#181611] text-white font-display">
      <Header title="Floor & Tables" subtitle="Assign tables to waiters and manage the floor" />

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete table" size="sm">
        <div className="flex flex-col gap-4">
          <div className="text-sm text-[#c9b792]">This removes the table from the floor. You can re-create it later.</div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="h-10 px-4 rounded-lg bg-[#2c261e] border border-[#352e24] text-[#c9b792] font-bold text-sm"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-sm"
              onClick={() => {
                const id = deleteTargetId;
                if (!id) return;
                const res = deleteTable(id);
                if (!res.ok) {
                  setActionBanner(res.error === 'table_has_open_order' ? 'Cannot delete a table with an open order.' : 'Failed to delete table.');
                  setDeleteOpen(false);
                  setDeleteTargetId('');
                  return;
                }
                setActionBanner('Table deleted.');
                setDeleteOpen(false);
                setDeleteTargetId('');
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 md:p-8 pb-32">
            <div className="max-w-7xl mx-auto flex flex-col gap-8">

                {actionBanner ? (
                  <div className="rounded-xl border border-[#352e24] bg-[#262016] p-4 text-sm text-[#c9b792] flex items-center justify-between gap-3">
                    <div>{actionBanner}</div>
                    <button type="button" className="h-9 px-3 rounded-lg bg-[#2c261e] border border-[#352e24] text-[#c9b792] font-bold text-xs" onClick={() => setActionBanner('')}>
                      Dismiss
                    </button>
                  </div>
                ) : null}
                
                {/* 1. Staff Selection Section */}
                <div className="flex flex-col gap-4">
                    <div className="flex justify-between items-end">
                        <div>
                            <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#eead2b] text-[#181611] text-sm font-bold">1</span>
                                Select Staff Member
                            </h2>
                            <p className="text-[#c9b792] text-sm mt-1 ml-8">Choose a waiter to assign tables to.</p>
                        </div>

                        <button
                            onClick={() => selectedStaffId && openWaiterFloor(selectedStaffId)}
                            disabled={!selectedStaffId}
                            className="h-10 px-4 rounded-xl bg-[#2c261e] border border-[#352e24] text-[#c9b792] font-bold text-xs hover:bg-[#352e24] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Open Floor View
                        </button>
                    </div>
                    
                    <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                        {availableStaff.length === 0 ? (
                          <div className="w-full rounded-xl border border-[#352e24] bg-[#262016] p-4 text-[#c9b792] text-sm">
                            No waiters found for this branch. Create staff under <span className="text-white font-bold">Staff Roster</span>.
                          </div>
                        ) : availableStaff.map((staff: any) => {
                            const isSelected = selectedStaffId === staff.id;
                            const lab = staffLabel(staff);
                            return (
                                <button 
                                    key={staff.id}
                                    onClick={() => handleStaffSelect(staff.id)}
                                    onDoubleClick={() => openWaiterFloor(staff.id)}
                                    className={`
                                        flex items-center gap-3 p-3 pr-6 rounded-xl border transition-all min-w-[200px] group
                                        ${isSelected 
                                            ? 'bg-[#eead2b] border-[#eead2b] text-[#181611] shadow-lg shadow-[#eead2b]/20' 
                                            : 'bg-[#262016] border border-[#352e24] text-[#c9b792] hover:border-[#eead2b]/50 hover:bg-[#2c261e]'
                                        }
                                    `}
                                >
                                    <div className={`relative p-0.5 rounded-full ${isSelected ? 'bg-[#181611]/20' : 'border border-[#483c23]'}`}>
                                        {lab.avatar ? (
                                          <img src={lab.avatar} alt={lab.name} className="w-10 h-10 rounded-full object-cover" />
                                        ) : (
                                          <div className="w-10 h-10 rounded-full bg-[#1a1612] border border-[#483c23] flex items-center justify-center text-xs font-black text-[#eead2b]">
                                            {lab.initials}
                                          </div>
                                        )}
                                        {lab.status === 'Active' && (
                                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[#262016] rounded-full"></div>
                                        )}
                                    </div>
                                    <div className="text-left">
                                        <p className={`font-bold text-sm ${isSelected ? 'text-[#181611]' : 'text-white'}`}>{lab.name}</p>
                                        <p className={`text-xs ${isSelected ? 'text-[#181611]/70' : 'text-[#c9b792]'}`}>{lab.role}</p>
                                    </div>
                                    {isSelected && <span className="material-symbols-outlined ml-auto text-xl">check_circle</span>}
                                  </button>
                            );
                        })}
                    </div>
                </div>

                <div className="h-px bg-[#352e24] w-full"></div>

                {/* 2. Table Selection Section */}
                <div className={`flex flex-col gap-6 transition-opacity duration-300 ${!selectedStaffId ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#eead2b] text-[#181611] text-sm font-bold">2</span>
                                Assign Tables
                            </h2>
                            <p className="text-[#c9b792] text-sm mt-1 ml-8">Select multiple tables for {selectedStaff ? selectedStaff.name.split(' ')[0] : 'the waiter'}.</p>
                        </div>
                        
                        <div className="flex gap-2">
                             {['All Zones', 'Main Hall', 'Patio', 'Bar Area'].map((zone) => (
                                <button
                                    key={zone}
                                    onClick={() => setSelectedZone(zone)}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                                        selectedZone === zone 
                                        ? 'bg-[#352e24] text-white border border-[#483c23]' 
                                        : 'text-[#c9b792] hover:text-white'
                                    }`}
                                >
                                    {zone}
                                </button>
                            ))}
                            <button
                                onClick={() => setAddOpen(true)}
                                className="px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all bg-[#eead2b] text-[#181611] hover:bg-[#d6961b]"
                            >
                                + New Table
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
                        {filteredTables.map((table) => {
                            const isSelected = selectedTableIds.has(table.id);
                            const assigned = table.assignedStaffId ? staffById.get(table.assignedStaffId) : null;
                            return (
                                <button
                                    key={table.id}
                                    onDoubleClick={() => openTable(table.id)}
                                    onClick={() => toggleTableSelection(table.id)}
                                    className={`
                                        relative aspect-square rounded-2xl flex flex-col items-center justify-center gap-2 transition-all duration-200 group
                                        ${isSelected 
                                            ? 'bg-[#3a2a16] border-2 border-[#eead2b] shadow-[0_0_20px_rgba(238,173,43,0.15)] scale-[1.02]' 
                                            : 'bg-[#1f1a14] border border-[#352e24] hover:border-[#5a4d3b] hover:bg-[#262016]'
                                        }
                                    `}
                                >
                                    {isSelected && (
                                        <div className="absolute top-2 right-2 bg-[#eead2b] text-[#181611] w-6 h-6 rounded-full flex items-center justify-center shadow-sm z-10">
                                            <span className="material-symbols-outlined text-[16px] font-bold">check</span>
                                        </div>
                                    )}
                                    
                                    <div className={`
                                        w-12 h-12 rounded-full flex items-center justify-center mb-1 transition-colors
                                        ${isSelected ? 'bg-[#eead2b] text-[#181611]' : 'bg-[#2c261e] text-[#5a4d3b] group-hover:text-[#c9b792]'}
                                        ${!isSelected && (table.status === 'occupied') ? 'bg-[#4a4032] text-[#1f1a14]' : ''}
                                    `}>
                                        <span className="material-symbols-outlined text-2xl">table_restaurant</span>
                                    </div>
                                    
                                    <div className="text-center">
                                        <h3 className={`text-xl font-black leading-none mb-1 ${isSelected ? 'text-white' : 'text-[#c9b792]'}`}>
                                            {table.code}
                                        </h3>
                                        <p className="text-[10px] font-bold text-[#8d7f70] uppercase tracking-wide">{table.seats} Seats</p>
                                    </div>

                                    {assigned ? (
                                      <div className="absolute top-2 left-2 text-[10px] font-bold px-2 py-1 rounded bg-[#eead2b]/10 border border-[#eead2b]/20 text-[#eead2b]">
                                        {assigned.name}
                                      </div>
                                    ) : (
                                      <div className="absolute top-2 left-2 text-[10px] font-bold px-2 py-1 rounded bg-white/5 border border-white/10 text-[#c9b792]">
                                        Unassigned
                                      </div>
                                    )}

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteTargetId(table.id);
                                        setDeleteOpen(true);
                                      }}
                                      className="absolute top-2 right-2 h-7 px-2 rounded-lg text-[10px] font-black bg-red-600/10 border border-red-600/20 text-red-300 hover:bg-red-600/20"
                                    >
                                      Delete
                                    </button>

                                    <div className="absolute bottom-3 left-0 w-full text-center">
                                        <span className={`text-[9px] font-black uppercase tracking-widest ${
                                            table.status === 'available' ? 'text-[#0bda19]' : 
                                            table.status === 'occupied' ? 'text-[#c9b792]' : 'text-[#eead2b]'
                                        }`}>
                                            {table.status}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>

        {/* Bottom Context Bar */}
        {selectedStaff && selectedTableIds.size > 0 && (
            <div className="absolute bottom-0 left-0 right-0 bg-[#262016] border-t border-[#352e24] p-4 lg:p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-30 animate-slide-up">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-5 w-full sm:w-auto">
                        <div className="h-14 w-14 rounded-full border-2 border-[#eead2b] p-0.5">
                            {staffLabel(selectedStaff).avatar ? (
                              <img src={staffLabel(selectedStaff).avatar} className="w-full h-full rounded-full object-cover" alt="Staff" />
                            ) : (
                              <div className="w-full h-full rounded-full bg-[#1a1612] border border-[#483c23] flex items-center justify-center text-sm font-black text-[#eead2b]">
                                {staffLabel(selectedStaff).initials}
                              </div>
                            )}
                        </div>
                        <div className="flex flex-col">
                            <h3 className="text-white text-xl font-bold leading-tight">Assigning to {staffLabel(selectedStaff).name}</h3>
                            <div className="flex items-center gap-2 text-[#c9b792] text-sm font-medium">
                                <span className="bg-[#eead2b] text-[#181611] px-1.5 rounded text-xs font-bold">{selectedTableIds.size}</span>
                                Tables Selected
                            </div>
                        </div>
                    </div>

                    <div className="flex w-full sm:w-auto gap-4">
                        <button 
                            onClick={() => {
                                setSelectedTableIds(new Set());
                                setSelectedStaffId(null);
                            }}
                            className="flex-1 sm:flex-none px-6 py-3.5 rounded-xl border border-[#352e24] bg-[#2c261e] text-[#c9b792] font-bold text-sm hover:bg-[#352e24] hover:text-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            className="flex-1 sm:flex-none px-8 py-3.5 rounded-xl bg-[#eead2b] hover:bg-[#d6961b] text-[#181611] font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-[#eead2b]/20"
                            onClick={() => {
                                setTableAssignment(Array.from(selectedTableIds), selectedStaff.id, staffLabel(selectedStaff).name);
                                setSelectedTableIds(new Set());
                                setSelectedStaffId(null);
                            }}
                        >
                            <span>Confirm Assignment</span>
                            <span className="material-symbols-outlined text-[20px]">check</span>
                        </button>

                        <button
                            className="flex-1 sm:flex-none px-8 py-3.5 rounded-xl bg-[#2c261e] hover:bg-[#352e24] text-[#c9b792] font-bold text-sm flex items-center justify-center gap-2 transition-colors border border-[#352e24]"
                            onClick={() => {
                                setTableAssignment(Array.from(selectedTableIds), null);
                                setSelectedTableIds(new Set());
                                setSelectedStaffId(null);
                            }}
                        >
                            <span>Unassign</span>
                            <span className="material-symbols-outlined text-[20px]">link_off</span>
                        </button>
                    </div>
                </div>
            </div>
        )}

        <Modal
            open={addOpen}
            title="Create New Table"
            onClose={() => {
                setAddOpen(false);
                setNewTableName('');
                setNewTableSeats('4');
                setNewTableArea('Main Hall');
            }}
            footer={
                <div className="flex gap-3">
                    <button
                        onClick={() => {
                            setAddOpen(false);
                            setNewTableName('');
                            setNewTableSeats('4');
                            setNewTableArea('Main Hall');
                        }}
                        className="flex-1 h-11 rounded-lg bg-[#393328] hover:bg-[#4a4234] border border-[#544b3b] text-white font-semibold transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            const seats = Number.parseInt(newTableSeats, 10);
                            if (!newTableName.trim() || !Number.isFinite(seats) || seats <= 0) return;
                            addTable({ name: newTableName.trim(), seats, area: newTableArea });
                            setAddOpen(false);
                            setNewTableName('');
                            setNewTableSeats('4');
                            setNewTableArea('Main Hall');
                        }}
                        className="flex-1 h-11 rounded-lg bg-[#eead2b] hover:bg-[#d49a26] text-[#181611] font-extrabold transition-colors"
                    >
                        Create
                    </button>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <label className="text-sm font-bold text-[#b9b09d]">Table Name</label>
                <input value={newTableName} onChange={(e) => setNewTableName(e.target.value)} className="w-full bg-[#2d2820] border border-[#544b3b] rounded-lg px-3 py-2 text-sm text-white" placeholder="T-07" />
                <label className="text-sm font-bold text-[#b9b09d]">Seats</label>
                <input value={newTableSeats} onChange={(e) => setNewTableSeats(e.target.value)} className="w-full bg-[#2d2820] border border-[#544b3b] rounded-lg px-3 py-2 text-sm text-white" placeholder="4" />
                <label className="text-sm font-bold text-[#b9b09d]">Area</label>
                <select value={newTableArea} onChange={(e) => setNewTableArea(e.target.value as any)} className="w-full bg-[#2d2820] border border-[#544b3b] rounded-lg px-3 py-2 text-sm text-white">
                    <option value="Main Hall">Main Hall</option>
                    <option value="Patio">Patio</option>
                    <option value="Bar Area">Bar Area</option>
                    <option value="Private Room">Private Room</option>
                </select>
            </div>
        </Modal>
      </div>
    </div>
  );
};
