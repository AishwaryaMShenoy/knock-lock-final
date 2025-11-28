import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInAnonymously, 
  signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  serverTimestamp, 
  Timestamp 
} from 'firebase/firestore';
import { 
  Lock, 
  Unlock, 
  Key, 
  Activity, 
  Shield, 
  ShieldAlert, 
  Trash2, 
  Plus, 
  History, 
  Wifi, 
  Ban, 
  CheckCircle,
  Smartphone,
  Zap
} from 'lucide-react';

// --- Configuration ---
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwg0mMTT_Ua8M7l51b4fde8u4DsVoUbwOCBtpmm7tz-norF9WuuTPW-l3Y-hCXQILOj/exec";

// --- Firebase Setup (Handles both Canvas and Local) ---
let firebaseConfig;

// @ts-ignore: __firebase_config is injected in the Canvas environment
if (typeof __firebase_config !== 'undefined') {
  // @ts-ignore
  firebaseConfig = JSON.parse(__firebase_config);
} else {
  // ------------------------------------------------------------------
  // ✅ CONFIGURATION ADDED
  // ------------------------------------------------------------------
  firebaseConfig = {
    apiKey: "AIzaSyAxIeM9eN-A8qcCfgm0jSmPmjuVav6SNrc",
    authDomain: "smart-lock-b5e55.firebaseapp.com",
    projectId: "smart-lock-b5e55",
    storageBucket: "smart-lock-b5e55.firebasestorage.app",
    messagingSenderId: "112917193550",
    appId: "1:112917193550:web:64c1a3281562ab99b5741f"
  };
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// @ts-ignore: __app_id is injected in Canvas
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Types ---
interface Log {
  id: string;
  type: 'UNLOCK' | 'RFID_ACCESS' | 'KNOCK_ACCESS' | 'DENIED' | 'SYSTEM';
  detail: string;
  timestamp: Timestamp | null;
}

interface RFIDTag {
  id: string;
  uid: string;
  name: string;
  blocked: boolean;
  addedAt: Timestamp;
}

interface KnockPattern {
  id: string;
  name: string;
  intervals: number[]; // ms between taps
  blocked: boolean;
}

// --- Helper: Send to Google Sheets ---
const sendToSheet = async (payload: any) => {
  try {
    // mode: 'no-cors' is required for Google Apps Script web apps
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors", 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    console.log("Sent to Sheets:", payload.action);
  } catch (e: any) {
    console.error("Sheet Sync Error", e);
  }
};

// --- Components ---

// 1. Dashboard & Remote Unlock
const Dashboard = ({ userId, onUnlock }: { userId: string, onUnlock: () => void }) => {
  const [unlocking, setUnlocking] = useState(false);
  const [status, setStatus] = useState('LOCKED');

  const handleUnlock = async () => {
    setUnlocking(true);
    setStatus('UNLOCKING...');
    
    try {
      // 1. Send Command to Hardware
      await addDoc(collection(db, 'artifacts', appId, 'users', userId, 'commands'), {
        type: 'UNLOCK',
        timestamp: serverTimestamp(),
        source: 'WEB_APP'
      });

      // 2. Log to Firestore
      await addDoc(collection(db, 'artifacts', appId, 'users', userId, 'access_logs'), {
        type: 'UNLOCK',
        detail: 'Remote unlock via App',
        timestamp: serverTimestamp()
      });

      // 3. Sync to Google Sheets
      sendToSheet({
        action: 'log',
        type: 'UNLOCK',
        detail: 'Remote unlock via App',
        source: 'WEB_APP'
      });

      onUnlock();

      setTimeout(() => {
        setUnlocking(false);
        setStatus('UNLOCKED');
        setTimeout(() => setStatus('LOCKED'), 5000); 
      }, 2000);
    } catch (e: any) {
      console.error("Unlock failed", e);
      setUnlocking(false);
      setStatus('ERROR');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full space-y-8 p-6">
      <div className={`relative w-64 h-64 rounded-full flex items-center justify-center transition-all duration-500 ${status === 'UNLOCKED' ? 'bg-green-500/20 shadow-[0_0_50px_rgba(34,197,94,0.3)]' : 'bg-slate-800 shadow-[0_0_30px_rgba(0,0,0,0.5)]'}`}>
        <div className={`w-56 h-56 rounded-full flex items-center justify-center border-4 transition-all duration-500 ${status === 'UNLOCKED' ? 'border-green-500 bg-green-500' : 'border-slate-700 bg-slate-900'}`}>
          {status === 'UNLOCKED' ? (
            <Unlock className="w-24 h-24 text-white" />
          ) : (
            <Lock className="w-24 h-24 text-slate-400" />
          )}
        </div>
        {unlocking && (
          <div className="absolute inset-0 rounded-full border-t-4 border-blue-500 animate-spin"></div>
        )}
      </div>

      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-white tracking-widest">{status}</h2>
        <p className="text-slate-400 text-sm">System Online & Secure</p>
      </div>

      <button
        onClick={handleUnlock}
        disabled={unlocking}
        className="w-full max-w-xs bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-bold py-4 px-8 rounded-xl shadow-lg transform transition-transform active:scale-95 flex items-center justify-center gap-3"
      >
        <Wifi className="w-5 h-5" />
        {unlocking ? 'Sending Signal...' : 'Remote Unlock'}
      </button>
    </div>
  );
};

// 2. RFID Management
const RFIDManager = ({ userId, tags }: { userId: string, tags: RFIDTag[] }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newUid, setNewUid] = useState('');
  const [newName, setNewName] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUid || !newName) return;

    // Firestore
    await addDoc(collection(db, 'artifacts', appId, 'users', userId, 'rfid_tags'), {
      uid: newUid,
      name: newName,
      blocked: false,
      addedAt: serverTimestamp()
    });

    // Google Sheets
    sendToSheet({
      action: 'add_tag',
      uid: newUid,
      name: newName
    });

    setNewUid('');
    setNewName('');
    setIsAdding(false);
  };

  const toggleBlock = async (tag: RFIDTag) => {
    const ref = doc(db, 'artifacts', appId, 'users', userId, 'rfid_tags', tag.id);
    await updateDoc(ref, { blocked: !tag.blocked });
  };

  const deleteTag = async (id: string) => {
    if (confirm('Permanently delete this key?')) {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', userId, 'rfid_tags', id));
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Key className="w-5 h-5 text-yellow-500" /> RFID Keys
        </h2>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="bg-slate-700 hover:bg-slate-600 text-white p-2 rounded-lg"
        >
          {isAdding ? <Ban className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-slate-800 p-4 rounded-xl space-y-3 border border-slate-700 animate-in slide-in-from-top-4">
          <h3 className="text-white font-medium">Add New Key</h3>
          <input 
            type="text" 
            placeholder="Card UID (e.g. A3 B4 C5)" 
            className="w-full bg-slate-900 border border-slate-700 text-white p-3 rounded-lg focus:outline-none focus:border-blue-500"
            value={newUid}
            onChange={(e) => setNewUid(e.target.value)}
          />
          <input 
            type="text" 
            placeholder="Owner Name (e.g. Mom)" 
            className="w-full bg-slate-900 border border-slate-700 text-white p-3 rounded-lg focus:outline-none focus:border-blue-500"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="w-full bg-blue-600 text-white p-3 rounded-lg font-bold">
            Register Key
          </button>
        </form>
      )}

      <div className="space-y-3">
        {tags.map(tag => (
          <div key={tag.id} className={`p-4 rounded-xl flex items-center justify-between border ${tag.blocked ? 'bg-red-900/10 border-red-900/30' : 'bg-slate-800 border-slate-700'}`}>
            <div>
              <div className="flex items-center gap-2">
                <h3 className={`font-bold ${tag.blocked ? 'text-red-400' : 'text-white'}`}>{tag.name}</h3>
                {tag.blocked && <span className="text-xs bg-red-900 text-red-200 px-2 py-0.5 rounded">BLOCKED</span>}
              </div>
              <p className="text-xs text-slate-500 font-mono mt-1">{tag.uid}</p>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => toggleBlock(tag)}
                className={`p-2 rounded-lg ${tag.blocked ? 'text-green-400 hover:bg-green-900/20' : 'text-orange-400 hover:bg-orange-900/20'}`}
                title={tag.blocked ? "Unblock" : "Block"}
              >
                {tag.blocked ? <CheckCircle className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
              </button>
              <button 
                onClick={() => deleteTag(tag.id)}
                className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        ))}
        {tags.length === 0 && !isAdding && (
          <div className="text-center py-10 text-slate-500">No RFID keys registered.</div>
        )}
      </div>
    </div>
  );
};

// 3. Knock Pattern Recorder
const KnockManager = ({ userId, patterns }: { userId: string, patterns: KnockPattern[] }) => {
  const [mode, setMode] = useState<'LIST' | 'RECORD'>('LIST');
  const [recording, setRecording] = useState(false);
  const [taps, setTaps] = useState<number[]>([]); // Timestamp of taps
  const [patternName, setPatternName] = useState('');
  
  const handleTap = () => {
    if (!recording) return;
    setTaps(prev => [...prev, Date.now()]);
  };

  const startRecording = () => {
    setTaps([]);
    setRecording(true);
  };

  const stopAndSave = async () => {
    setRecording(false);
    if (taps.length < 2) {
      alert("Pattern too short! Tap at least twice.");
      return;
    }
    if (!patternName) {
      alert("Please name this pattern first.");
      return;
    }

    // Convert timestamps to intervals (deltas)
    const intervals: number[] = [];
    for (let i = 1; i < taps.length; i++) {
      intervals.push(taps[i] - taps[i-1]);
    }

    // Firestore
    await addDoc(collection(db, 'artifacts', appId, 'users', userId, 'knock_patterns'), {
      name: patternName,
      intervals,
      blocked: false,
      createdAt: serverTimestamp()
    });

    // Google Sheets
    sendToSheet({
      action: 'add_pattern',
      name: patternName,
      intervals: intervals
    });

    setMode('LIST');
    setPatternName('');
    setTaps([]);
  };

  const toggleBlock = async (pat: KnockPattern) => {
    await updateDoc(doc(db, 'artifacts', appId, 'users', userId, 'knock_patterns', pat.id), { blocked: !pat.blocked });
  };

  const deletePattern = async (id: string) => {
    if(confirm('Delete this knock pattern?')) {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', userId, 'knock_patterns', id));
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-purple-500" /> Knock Patterns
        </h2>
        {mode === 'LIST' && patterns.length < 5 && (
          <button 
            onClick={() => setMode('RECORD')}
            className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
          >
            New Pattern
          </button>
        )}
      </div>

      {mode === 'RECORD' && (
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 flex flex-col items-center gap-6 animate-in zoom-in-95">
          <div className="w-full">
            <label className="text-xs text-slate-400 uppercase font-bold mb-1 block">Pattern Name</label>
            <input 
              className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"
              placeholder="e.g. Secret Knock"
              value={patternName}
              onChange={e => setPatternName(e.target.value)}
            />
          </div>

          <div className="flex flex-col items-center gap-4 w-full">
            {!recording ? (
              <button onClick={startRecording} className="w-full py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 font-bold">
                Start Recording
              </button>
            ) : (
              <>
                <button 
                  onMouseDown={handleTap}
                  onTouchStart={(e) => { e.preventDefault(); handleTap(); }} // Better for mobile latency
                  className="w-32 h-32 rounded-full bg-purple-600 active:bg-purple-400 active:scale-95 transition-all shadow-lg flex items-center justify-center border-4 border-purple-800"
                >
                  <span className="text-2xl font-bold text-white">TAP!</span>
                </button>
                <p className="text-slate-400 text-sm">{taps.length} taps recorded</p>
                <div className="flex gap-2 w-full mt-4">
                  <button onClick={() => { setRecording(false); setTaps([]); }} className="flex-1 py-2 bg-red-900/50 text-red-300 rounded hover:bg-red-900/80">Cancel</button>
                  <button onClick={stopAndSave} className="flex-1 py-2 bg-green-600 text-white rounded hover:bg-green-500 font-bold">Save</button>
                </div>
              </>
            )}
          </div>
          
          <div className="h-8 flex items-end gap-1 w-full justify-center">
             {taps.map((_, i) => (
                <div key={i} className="w-2 bg-purple-400 rounded-t" style={{ height: '100%' }}></div>
             ))}
          </div>
        </div>
      )}

      {mode === 'LIST' && (
        <div className="space-y-3">
          {patterns.map(pat => (
            <div key={pat.id} className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex justify-between items-center">
              <div>
                <h3 className={`font-bold ${pat.blocked ? 'text-slate-500 line-through' : 'text-white'}`}>{pat.name}</h3>
                <p className="text-xs text-slate-500">{pat.intervals.length + 1} Taps</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => toggleBlock(pat)} className={`p-2 rounded ${pat.blocked ? 'text-green-400 bg-green-900/10' : 'text-slate-400 bg-slate-700'}`}>
                   {pat.blocked ? 'Enable' : 'Block'}
                </button>
                <button onClick={() => deletePattern(pat.id)} className="p-2 rounded text-red-400 bg-red-900/10 hover:bg-red-900/30">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {patterns.length === 0 && <p className="text-center text-slate-500 py-8">No knock patterns set.</p>}
          {patterns.length >= 5 && <p className="text-center text-orange-400 text-xs">Max 5 patterns reached.</p>}
        </div>
      )}
    </div>
  );
};

// 4. Logs Viewer (with Auto-Cleanup)
const LogViewer = ({ logs, onDeleteOld }: { logs: Log[], onDeleteOld: () => void }) => {
  
  useEffect(() => {
    onDeleteOld();
  }, []);

  const getIcon = (type: string) => {
    switch (type) {
      case 'UNLOCK': return <Wifi className="w-4 h-4 text-blue-400" />;
      case 'RFID_ACCESS': return <Key className="w-4 h-4 text-green-400" />;
      case 'KNOCK_ACCESS': return <Zap className="w-4 h-4 text-purple-400" />;
      case 'DENIED': return <ShieldAlert className="w-4 h-4 text-red-500" />;
      default: return <Activity className="w-4 h-4 text-slate-400" />;
    }
  };

  const formatDate = (ts: Timestamp | null) => {
    if (!ts) return 'Unknown';
    return ts.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-slate-800/50 sticky top-0 backdrop-blur-sm border-b border-slate-700">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <History className="w-5 h-5" /> Access Log
        </h2>
        <p className="text-xs text-slate-500 mt-1">Logs older than 30 days are auto-deleted.</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {logs.map(log => (
          <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800 border border-slate-700">
            <div className="mt-1">{getIcon(log.type)}</div>
            <div className="flex-1">
              <div className="flex justify-between items-start">
                <span className="text-sm font-medium text-white">{log.detail}</span>
                <span className="text-xs text-slate-500 whitespace-nowrap ml-2">{formatDate(log.timestamp)}</span>
              </div>
              <span className="text-xs text-slate-400 font-mono">{log.type}</span>
            </div>
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-center py-10 text-slate-500">No activity recorded yet.</div>
        )}
      </div>
    </div>
  );
};

// --- Main App Component ---
export default function SmartLockApp() {
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'HOME' | 'RFID' | 'KNOCK' | 'LOGS'>('HOME');
  
  const [tags, setTags] = useState<RFIDTag[]>([]);
  const [patterns, setPatterns] = useState<KnockPattern[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    const initAuth = async () => {
      // @ts-ignore
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        // @ts-ignore
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsubTags = onSnapshot(
      collection(db, 'artifacts', appId, 'users', user.uid, 'rfid_tags'),
      (snap) => {
        const t = snap.docs.map(d => ({ id: d.id, ...d.data() } as RFIDTag));
        setTags(t);
      },
      (err: any) => console.error("Tags error", err)
    );

    const unsubKnocks = onSnapshot(
      collection(db, 'artifacts', appId, 'users', user.uid, 'knock_patterns'),
      (snap) => {
        const p = snap.docs.map(d => ({ id: d.id, ...d.data() } as KnockPattern));
        setPatterns(p);
      },
      (err: any) => console.error("Patterns error", err)
    );

    const unsubLogs = onSnapshot(
      collection(db, 'artifacts', appId, 'users', user.uid, 'access_logs'),
      (snap) => {
        const l = snap.docs.map(d => ({ id: d.id, ...d.data() } as Log));
        l.sort((a, b) => {
          const tA = a.timestamp?.toMillis() || 0;
          const tB = b.timestamp?.toMillis() || 0;
          return tB - tA;
        });
        setLogs(l);
      },
      (err: any) => console.error("Logs error", err)
    );

    return () => {
      unsubTags();
      unsubKnocks();
      unsubLogs();
    };
  }, [user]);

  const pruneLogs = async () => {
    if (!user || logs.length === 0) return;
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    const oldLogs = logs.filter(l => {
      const ms = l.timestamp?.toMillis();
      return ms && ms < thirtyDaysAgo;
    });

    for (const log of oldLogs) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'access_logs', log.id));
      } catch (e: any) {
        console.error("Failed to prune log", log.id);
      }
    }
    if (oldLogs.length > 0) {
      console.log(`Pruned ${oldLogs.length} old logs.`);
    }
  };

  if (!user) return <div className="h-screen bg-slate-950 flex items-center justify-center text-white">Initializing Security Protocol...</div>;

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 font-sans flex flex-col overflow-hidden max-w-md mx-auto shadow-2xl border-x border-slate-800">
      
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-blue-500" />
          <h1 className="font-bold text-lg tracking-wide text-white">KNOCK<span className="text-blue-500">LOCK</span></h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          Connected
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        {activeTab === 'HOME' && <Dashboard userId={user.uid} onUnlock={() => {}} />}
        {activeTab === 'RFID' && <RFIDManager userId={user.uid} tags={tags} />}
        {activeTab === 'KNOCK' && <KnockManager userId={user.uid} patterns={patterns} />}
        {activeTab === 'LOGS' && <LogViewer logs={logs} onDeleteOld={pruneLogs} />}
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-slate-900 border-t border-slate-800 p-2 flex justify-around items-center pb-6">
        <TabButton icon={Lock} label="Control" active={activeTab === 'HOME'} onClick={() => setActiveTab('HOME')} />
        <TabButton icon={Key} label="RFID" active={activeTab === 'RFID'} onClick={() => setActiveTab('RFID')} />
        <TabButton icon={Zap} label="Knock" active={activeTab === 'KNOCK'} onClick={() => setActiveTab('KNOCK')} />
        <TabButton icon={History} label="Logs" active={activeTab === 'LOGS'} onClick={() => setActiveTab('LOGS')} />
      </nav>
    </div>
  );
}

const TabButton = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors w-16 ${active ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500 hover:text-slate-300'}`}
  >
    <Icon className="w-6 h-6" />
    <span className="text-[10px] font-medium">{label}</span>
  </button>
);