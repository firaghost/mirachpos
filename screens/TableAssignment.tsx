import { AppIcon } from '@/components/ui/app-icon';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal';
import { Header } from '../components/Header';
import { Screen } from '../types';
import { usePos } from '../PosContext';
import { apiFetch } from '../api';
import { readSession } from '../session';

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
  const [newTableArea, setNewTableArea] = useState<string>('');

  const [editOpen, setEditOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string>('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string>('');
  const [actionBanner, setActionBanner] = useState('');

  const [remoteStaff, setRemoteStaff] = useState<StaffRow[]>([]);

  useEffect(() => {
    try {
      const s = readSession<any>();
      const role = typeof s?.role === 'string' ? s.role : '';
      if (role !== 'Branch Manager' && role !== 'Cafe Owner') return;
    } catch {
      return;
    }
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

  const availableZones = useMemo(() => {
    const set = new Set<string>();
    for (const t of tables) {
      const z = typeof (t as any).area === 'string' ? String((t as any).area).trim() : '';
      if (z) set.add(z);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tables]);

  useEffect(() => {
    if (selectedZone === 'All Zones') return;
    if (availableZones.includes(selectedZone)) return;
    setSelectedZone('All Zones');
  }, [availableZones, selectedZone]);

  const filteredTables = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tables
      .filter((t) => {
        const zone = typeof (t as any).area === 'string' ? String((t as any).area).trim() : '';
        const matchesZone = selectedZone === 'All Zones' || (zone && zone === selectedZone);
        const matchesSearch = q.length === 0 ? true : t.name.toLowerCase().includes(q);
        return matchesZone && matchesSearch;
      })
      .map((t) => ({
        id: t.id,
        code: t.name,
        seats: t.seats,
        zone: (typeof (t as any).area === 'string' ? String((t as any).area).trim() : '') as string,
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
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground font-display">
      <Header title="Floor & Tables" subtitle="Assign tables to waiters and manage the floor" />

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete table" size="sm">
        <div className="flex flex-col gap-4">
          <div className="text-sm text-muted-foreground">This removes the table from the floor. You can re-create it later.</div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="h-10 px-4 rounded-lg bg-secondary border border-border text-foreground font-bold text-sm"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-10 px-4 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold text-sm"
              onClick={() => {
                const id = deleteTargetId;
                if (!id) return;
                const t = tables.find((x) => x.id === id) as any;
                if (t && t.openOrderId) {
                  setActionBanner('Cannot delete a table with an open order.');
                  setDeleteOpen(false);
                  setDeleteTargetId('');
                  return;
                }

                deleteTable(id);
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
                  <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground flex items-center justify-between gap-3">
                    <div>{actionBanner}</div>
                    <button type="button" className="h-9 px-3 rounded-lg bg-secondary border border-border text-foreground font-bold text-xs" onClick={() => setActionBanner('')}>
                      Dismiss
                    </button>
                  </div>
                ) : null}
                
                {/* 1. Staff Selection Section */}
                <div className="flex flex-col gap-4">
                    <div className="flex justify-between items-end">
                        <div>
                            <h2 className="text-2xl font-black text-foreground tracking-tight flex items-center gap-2">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold">1</span>
                                Select Staff Member
                            </h2>
                            <p className="text-muted-foreground text-sm mt-1 ml-8">Choose a waiter to assign tables to.</p>
                        </div>

                        <button
                            onClick={() => selectedStaffId && openWaiterFloor(selectedStaffId)}
                            disabled={!selectedStaffId}
                            className="h-10 px-4 rounded-xl bg-secondary border border-border text-foreground font-bold text-xs hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Open Floor View
                        </button>
                    </div>
                    
                    <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                        {availableStaff.length === 0 ? (
                          <div className="w-full rounded-xl border border-border bg-card p-4 text-muted-foreground text-sm">
                            No waiters found for this branch. Create staff under <span className="text-foreground font-bold">Staff Roster</span>.
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
                                            ? 'bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/20' 
                                            : 'bg-card border border-border text-muted-foreground hover:border-primary/40 hover:bg-accent'
                                        }
                                    `}
                                >
                                    <div className={`relative p-0.5 rounded-full ${isSelected ? 'bg-primary/10' : 'border border-border'}`}>
                                        {lab.avatar ? (
                                          <img src={lab.avatar} alt={lab.name} className="w-10 h-10 rounded-full object-cover" />
                                        ) : (
                                          <div className="w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center text-xs font-black text-primary">
                                            {lab.initials}
                                          </div>
                                        )}
                                        {lab.status === 'Active' && (
                                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full"></div>
                                        )}
                                    </div>
                                    <div className="text-left">
                                        <p className={`font-bold text-sm ${isSelected ? 'text-primary-foreground' : 'text-foreground'}`}>{lab.name}</p>
                                        <p className={`text-xs ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{lab.role}</p>
                                    </div>
                                    {isSelected && <AppIcon name="check_circle" className="ml-auto text-xl" size={20} />}
                                  </button>
                            );
                        })}
                    </div>
                </div>

                <div className="h-px bg-border w-full"></div>

                {/* 2. Table Selection Section */}
                <div className={`flex flex-col gap-6 transition-opacity duration-300 ${!selectedStaffId ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-black text-foreground tracking-tight flex items-center gap-2">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold">2</span>
                                Assign Tables
                            </h2>
                            <p className="text-muted-foreground text-sm mt-1 ml-8">Select multiple tables for {selectedStaff ? selectedStaff.name.split(' ')[0] : 'the waiter'}.</p>
                        </div>
                        
                        <div className="flex gap-2">
                             {['All Zones', ...availableZones].map((zone) => (
                                <button
                                    key={zone}
                                    onClick={() => setSelectedZone(zone)}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                                        selectedZone === zone 
                                        ? 'bg-secondary text-foreground border border-border' 
                                        : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {zone}
                                </button>
                            ))}
                            <button
                                onClick={() => setAddOpen(true)}
                                className="px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all bg-primary text-primary-foreground hover:bg-primary/90"
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
                                <div
                                    key={table.id}
                                    onDoubleClick={() => openTable(table.id)}
                                    onClick={() => toggleTableSelection(table.id)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        toggleTableSelection(table.id);
                                      }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    className={`
                                        relative aspect-square rounded-2xl flex flex-col items-center justify-center gap-2 transition-all duration-200 group
                                        ${isSelected 
                                            ? 'bg-primary/10 border-2 border-primary shadow-[0_0_20px_rgba(0,0,0,0.12)] scale-[1.02]' 
                                            : 'bg-card border border-border hover:border-border/80 hover:bg-accent'
                                        }
                                    `}
                                >
                                    {isSelected && (
                                        <div className="absolute top-2 right-2 bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center shadow-sm z-10">
                                            <AppIcon name="check" className="text-[16px] font-bold" size={16} />
                                        </div>
                                    )}
                                    
                                    <div className={`
                                        w-12 h-12 rounded-full flex items-center justify-center mb-1 transition-colors
                                        ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground group-hover:text-foreground'}
                                        ${!isSelected && (table.status === 'occupied') ? 'bg-muted text-foreground/70' : ''}
                                    `}>
                                        <AppIcon name="table_restaurant" className="text-2xl" size={24} />
                                    </div>
                                    
                                    <div className="text-center">
                                        <h3 className={`text-xl font-black leading-none mb-1 ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                                            {table.code}
                                        </h3>
                                        <p className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-wide">{table.seats} Seats</p>
                                    </div>

                                    {assigned ? (
                                      <div className="absolute top-2 left-2 text-[10px] font-bold px-2 py-1 rounded bg-primary/10 border border-primary/20 text-primary">
                                        {assigned.name}
                                      </div>
                                    ) : (
                                      <div className="absolute top-2 left-2 text-[10px] font-bold px-2 py-1 rounded bg-secondary/50 border border-border text-muted-foreground">
                                        Unassigned
                                      </div>
                                    )}

                                    {/* Edit and Delete buttons - always visible and vivid */}
                                    <div className="absolute top-2 right-2 flex gap-1 z-10">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          // Open edit modal - populate form with table data
                                          const t = tables.find((tbl) => tbl.id === table.id);
                                          if (t) {
                                            setNewTableName(t.name);
                                            setNewTableSeats(String(t.seats));
                                            setNewTableArea(typeof (t as any).area === 'string' ? (t as any).area : '');
                                            setEditTargetId(t.id);
                                            setEditOpen(true);
                                          }
                                        }}
                                        className="h-7 w-7 rounded-full bg-blue-500 hover:bg-blue-600 text-white shadow-lg flex items-center justify-center text-xs"
                                        title="Edit table"
                                      >
                                        <AppIcon name="edit" size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDeleteTargetId(table.id);
                                          setDeleteOpen(true);
                                        }}
                                        className="h-7 w-7 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg flex items-center justify-center text-xs"
                                        title="Delete table"
                                      >
                                        <AppIcon name="delete" size={14} />
                                      </button>
                                    </div>

                                    <div className="absolute bottom-3 left-0 w-full text-center">
                                        <span className={`text-[9px] font-black uppercase tracking-widest ${
                                            table.status === 'available' ? 'text-emerald-500' : 
                                            table.status === 'occupied' ? 'text-muted-foreground' : 'text-primary'
                                        }`}>
                                            {table.status}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>

        {/* Bottom Context Bar */}
        {selectedStaff && selectedTableIds.size > 0 && (
            <div className="absolute bottom-0 left-0 right-0 bg-card border-t border-border p-4 lg:p-6 shadow-lg z-30 animate-slide-up">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-5 w-full sm:w-auto">
                        <div className="h-14 w-14 rounded-full border-2 border-primary p-0.5">
                            {staffLabel(selectedStaff).avatar ? (
                              <img src={staffLabel(selectedStaff).avatar} className="w-full h-full rounded-full object-cover" alt="Staff" />
                            ) : (
                              <div className="w-full h-full rounded-full bg-background border border-border flex items-center justify-center text-sm font-black text-primary">
                                {staffLabel(selectedStaff).initials}
                              </div>
                            )}
                        </div>
                        <div className="flex flex-col">
                            <h3 className="text-foreground text-xl font-bold leading-tight">Assigning to {staffLabel(selectedStaff).name}</h3>
                            <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
                                <span className="bg-primary text-primary-foreground px-1.5 rounded text-xs font-bold">{selectedTableIds.size}</span>
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
                            className="flex-1 sm:flex-none px-6 py-3.5 rounded-xl border border-border bg-secondary text-foreground font-bold text-sm hover:bg-secondary/80 transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            className="flex-1 sm:flex-none px-8 py-3.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-primary/20"
                            onClick={() => {
                                setTableAssignment(Array.from(selectedTableIds), selectedStaff.id, staffLabel(selectedStaff).name);
                                setSelectedTableIds(new Set());
                                setSelectedStaffId(null);
                            }}
                        >
                            <span>Confirm Assignment</span>
                            <AppIcon name="check" className="text-[20px]" size={20} />
                        </button>

                        <button
                            className="flex-1 sm:flex-none px-8 py-3.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground font-bold text-sm flex items-center justify-center gap-2 transition-colors border border-border"
                            onClick={() => {
                                setTableAssignment(Array.from(selectedTableIds), null);
                                setSelectedTableIds(new Set());
                                setSelectedStaffId(null);
                            }}
                        >
                            <span>Unassign</span>
                            <AppIcon name="link_off" className="text-[20px]" size={20} />
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
                setNewTableArea('');
            }}
            footer={
                <div className="flex gap-3">
                    <button
                        onClick={() => {
                            setAddOpen(false);
                            setNewTableName('');
                            setNewTableSeats('4');
                            setNewTableArea('');
                        }}
                        className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            const seats = Number.parseInt(newTableSeats, 10);
                            if (!newTableName.trim() || !Number.isFinite(seats) || seats <= 0) return;
                            const area = newTableArea.trim();
                            addTable({ name: newTableName.trim(), seats, area: area ? area : undefined });
                            setAddOpen(false);
                            setNewTableName('');
                            setNewTableSeats('4');
                            setNewTableArea('');
                        }}
                        className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors"
                    >
                        Create
                    </button>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <label className="text-sm font-bold text-muted-foreground">Table Name</label>
                <input value={newTableName} onChange={(e) => setNewTableName(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" placeholder="T-07" />
                <label className="text-sm font-bold text-muted-foreground">Seats</label>
                <input value={newTableSeats} onChange={(e) => setNewTableSeats(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" placeholder="4" />
                <label className="text-sm font-bold text-muted-foreground">Area</label>
                <input
                  value={newTableArea}
                  onChange={(e) => setNewTableArea(e.target.value)}
                  list="table-area-suggestions"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                  placeholder="e.g. Main Hall"
                />
                <datalist id="table-area-suggestions">
                  {availableZones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
            </div>
        </Modal>

        <Modal
            open={editOpen}
            title="Edit Table"
            onClose={() => {
                setEditOpen(false);
                setEditTargetId('');
                setNewTableName('');
                setNewTableSeats('4');
                setNewTableArea('');
            }}
            footer={
                <div className="flex gap-3">
                    <button
                        onClick={() => {
                            setEditOpen(false);
                            setEditTargetId('');
                            setNewTableName('');
                            setNewTableSeats('4');
                            setNewTableArea('');
                        }}
                        className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            const seats = Number.parseInt(newTableSeats, 10);
                            if (!newTableName.trim() || !Number.isFinite(seats) || seats <= 0) return;
                            const area = newTableArea.trim();
                            // Update table using addTable with same ID (will overwrite)
                            const t = tables.find((tbl) => tbl.id === editTargetId);
                            if (t) {
                              deleteTable(t.id);
                              // Small delay to ensure delete is processed before add
                              setTimeout(() => {
                                addTable({ id: t.id, name: newTableName.trim(), seats, area: area ? area : undefined });
                              }, 100);
                            }
                            setEditOpen(false);
                            setEditTargetId('');
                            setNewTableName('');
                            setNewTableSeats('4');
                            setNewTableArea('');
                            setActionBanner('Table updated.');
                        }}
                        className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors"
                    >
                        Save
                    </button>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <label className="text-sm font-bold text-muted-foreground">Table Name</label>
                <input value={newTableName} onChange={(e) => setNewTableName(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" placeholder="T-07" />
                <label className="text-sm font-bold text-muted-foreground">Seats</label>
                <input value={newTableSeats} onChange={(e) => setNewTableSeats(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" placeholder="4" />
                <label className="text-sm font-bold text-muted-foreground">Area</label>
                <input
                  value={newTableArea}
                  onChange={(e) => setNewTableArea(e.target.value)}
                  list="table-area-suggestions"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                  placeholder="e.g. Main Hall"
                />
                <datalist id="table-area-suggestions">
                  {availableZones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
            </div>
        </Modal>
      </div>
    </div>
  );
};
