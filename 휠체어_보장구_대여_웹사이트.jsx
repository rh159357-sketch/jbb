import React, { useEffect, useMemo, useState } from "react";

// 휠체어·보장구 대여 웹사이트 (실시간 현황 + 대여/반납 동시 보기)
// - 좌측: 실시간 재고/가용 현황
// - 우측: 대여 신청 + 반납 처리(리스트/빠른 반납)
// - 정책: 장애인 3개월 / 비장애인 1개월 (연장 가능)

const cls = (...a) => a.filter(Boolean).join(" ");
const todayISO = () => new Date().toISOString().slice(0, 10);
const addMonths = (dateStr, months) => {
  const base = new Date(dateStr);
  const day = base.getDate();
  // 달 이동 전에 1일로 설정하여 오버플로 방지
  const d = new Date(base);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  // 해당 월의 마지막 날 계산 후 원래 일자를 클램핑
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};
const isActiveRental = (r, at = new Date()) => {
  const due = new Date(r.dueDate);
  return new Date(r.startDate) <= at && due >= at && r.status !== "반납";
};

// 반납일 기준 30일 지난 이력 자동 정리 (반납건만 대상)
const pruneOldReturns = (list, now = new Date()) => {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  return list.filter(r => {
    if (r.status !== "반납") return true; // 대여중은 유지
    const ret = new Date(r.returnedAt || r.dueDate || r.startDate || 0);
    return now - ret < THIRTY_DAYS; // 30일 미만인 반납 이력만 유지
  });
};

const DEFAULT_ITEMS = [
  { id: "WCHAIR-001", name: "수동휠체어(표준형)", qty: 6 },
  { id: "WCHAIR-002", name: "경량휠체어", qty: 3 },
  { id: "WCHAIR-003", name: "요양형 휠체어", qty: 2 },
  { id: "CRUTCH-101", name: "목발", qty: 10 },
];

function useLocalState(key, initial) {
  const [state, setState] = useState(() => {
    const raw = localStorage.getItem(key);
    if (!raw) return initial;
    try { return JSON.parse(raw); } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [key, state]);
  return [state, setState];
}

export default function App() {
  const [items, setItems] = useLocalState("items", DEFAULT_ITEMS);
  const [rentals, setRentals] = useLocalState("rentals", []);
  const [tab, setTab] = useState("실시간 현황+대여신청");

  // 재고 계산 (대여 중 수량 차감)
  const reservedMap = useMemo(() => {
    const m = new Map();
    const now = new Date();
    rentals.forEach(r => { if (isActiveRental(r, now)) m.set(r.itemId, (m.get(r.itemId) || 0) + r.qty); });
    return m;
  }, [rentals]);

  const visibleStock = useMemo(() =>
    items.map(it => ({ ...it, available: Math.max(0, it.qty - (reservedMap.get(it.id) || 0)) })),
    [items, reservedMap]
  );

  const activeRentals = useMemo(() => rentals.filter(r => isActiveRental(r)), [rentals]);

  // --- Lightweight self tests (console) ---
  useEffect(() => {
    try {
      console.group("SELF TESTS");
      // 1) addMonths 말일 롤오버
      console.assert(addMonths("2025-01-31", 1).startsWith("2025-02"), "addMonths rollover to Feb");
      console.assert(addMonths("2025-01-30", 1).startsWith("2025-02"), "addMonths normal case");
      console.assert(addMonths("2024-02-29", 12) === "2025-02-28", "leap year clamp");
      // 2) 가용 수량은 총수량을 초과하지 않음
      const total = items.reduce((s,i)=>s+i.qty,0);
      const availableSum = visibleStock.reduce((s,i)=>s+i.available,0);
      console.assert(availableSum <= total, "available never exceeds total");
      // 3) 음수 가용 방지
      console.assert(visibleStock.every(i => i.available >= 0), "availability non-negative");
      // 4) 활성 대여는 반납 상태 제외
      const activeOk = activeRentals.every(r => r.status !== "반납");
      console.assert(activeOk, "active rentals exclude returned");
      // 5) 30일 경과 반납 이력 삭제 검증 (순수 함수)
      const now = new Date();
      const old = new Date(now.getTime() - 31*24*60*60*1000).toISOString();
      const recent = new Date(now.getTime() - 10*24*60*60*1000).toISOString();
      const sample = [
        { id:'a', status:'반납', returnedAt: old },
        { id:'b', status:'반납', returnedAt: recent },
        { id:'c', status:'대여중' }
      ];
      const pruned = pruneOldReturns(sample, now);
      console.assert(pruned.some(x=>x.id==='b') && pruned.some(x=>x.id==='c') && !pruned.some(x=>x.id==='a'), "pruneOldReturns keeps recent/active, drops >30d");
    } finally { console.groupEnd?.(); }
  }, [items, visibleStock, activeRentals]);

  // 반납 후 30일 지난 이력 자동 삭제
  useEffect(() => {
    const pruned = pruneOldReturns(rentals);
    if (pruned.length !== rentals.length) setRentals(pruned);
  }, [rentals, setRentals]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="text-xl font-bold">보장구 대여</div>
          <nav className="flex gap-2 flex-wrap">
            {['실시간 현황+대여신청','빠른 반납처리+반납관리','보장구 추가','기능 안내'].map(t => (
              <button key={t} onClick={()=>setTab(t)} className={cls('px-3 py-1.5 rounded-full text-sm', tab===t?'bg-gray-900 text-white':'hover:bg-gray-200')}>{t}</button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === '실시간 현황+대여신청' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <Dashboard items={visibleStock} rentals={activeRentals} />
            <RentalForm items={visibleStock} onSubmit={(r)=>setRentals(rs=>[...rs,r])} />
          </div>
        )}

        {tab === '빠른 반납처리+반납관리' && (
          <ReturnPanel items={items} rentals={rentals} setRentals={setRentals} />
        )}

        {tab === '보장구 추가' && (
          <ItemAddPanel items={items} setItems={setItems} />
        )}

        {tab === '기능 안내' && (
          <FeatureList />
        )}
      </main>
    </div>
  );
}

function Dashboard({ items, rentals }) {
  const total = items.reduce((s, i) => s + i.qty, 0);
  const inUse = rentals.reduce((s, r) => s + r.qty, 0);
  const available = Math.max(0, total - inUse);
  const util = total ? Math.round((inUse / total) * 100) : 0;

  const [sortKey, setSortKey] = useState("default"); // default 유지
  const sortedItems = useMemo(() => {
    const arr = [...items];
    switch (sortKey) {
      case "nameAsc":
        return arr.sort((a,b)=>a.name.localeCompare(b.name));
      case "nameDesc":
        return arr.sort((a,b)=>b.name.localeCompare(a.name));
      case "availDesc":
        return arr.sort((a,b)=> (b.available - a.available) || a.name.localeCompare(b.name));
      case "qtyDesc":
        return arr.sort((a,b)=> (b.qty - a.qty) || a.name.localeCompare(b.name));
      default:
        return arr; // 기존 순서 유지
    }
  }, [items, sortKey]);

  return (
    <Card title="실시간 대여 현황" actions={(
      <select className="input w-auto" value={sortKey} onChange={e=>setSortKey(e.target.value)}>
        <option value="default">정렬: 기본</option>
        <option value="availDesc">잔여↓</option>
        <option value="qtyDesc">총수량↓</option>
        <option value="nameAsc">이름↑</option>
        <option value="nameDesc">이름↓</option>
      </select>
    )}>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <KPI label="총 보유" value={total} />
        <KPI label="대여 중" value={inUse} />
        <KPI label="잔여 재고" value={available} />
      </div>
      <div className="text-sm text-gray-600 mb-2">가동률 {util}%</div>
      <div className="grid md:grid-cols-2 gap-3">
        {sortedItems.map(it => (
          <div key={it.id} className="border rounded-xl p-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-semibold">{it.name}</div>
                <div className="text-xs text-gray-500">{it.id}</div>
              </div>
              <div className={cls("px-3 py-1 rounded-full text-sm", it.available>0?"bg-green-100 text-green-800":"bg-gray-200 text-gray-500")}>잔여 {it.available}/{it.qty}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function KPI({ label, value }) {
  return (
    <div className="bg-white rounded-2xl border p-4">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function Card({ title, children, actions }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 border">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </div>
  );
}

function RentalForm({ items, onSubmit }) {
  const [form, setForm] = useState({
    name: "",
    phoneLast: "",
    region: "고창읍",
    isDisabled: true,
    itemId: items[0]?.id || "",
    qty: 1,
    startDate: todayISO(),
  });

  useEffect(() => {
    if (!items.length) return;
    if (!items.find(i => i.id === form.itemId)) setForm(f => ({ ...f, itemId: items[0].id }));
  }, [items]);

  const selected = items.find(i => i.id === form.itemId);
  const maxMonths = form.isDisabled ? 3 : 1;
  const dueDate = addMonths(form.startDate, maxMonths);
  const canSubmit = form.name && form.phoneLast && form.region && form.qty > 0 && form.qty <= (selected?.available ?? 0);

  const submit = () => {
    if (!canSubmit) return;
    const payload = {
      id: crypto.randomUUID(),
      ...form,
      dueDate,
      status: "대여중",
      createdAt: new Date().toISOString(),
    };
    onSubmit(payload);
    alert(`대여 신청 완료: ${form.name} (${form.region})`);
    setForm(f => ({ ...f, name: "", phoneLast: "", qty: 1 }));
  };

  return (
    <Card title="대여 신청">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="이름 *"><input className="input" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="홍길동" /></Field>
        <Field label="연락처 뒷번호 *"><input className="input" value={form.phoneLast} onChange={e=>setForm({...form,phoneLast:e.target.value})} placeholder="1234" /></Field>
        <Field label="거주 지역 *"><input className="input" value={form.region} onChange={e=>setForm({...form,region:e.target.value})} placeholder="○○읍/면" /></Field>
        <Field label="대여 시작일 *">
          <input type="date" className="input" value={form.startDate} min={todayISO()} onChange={e=>setForm({...form,startDate:e.target.value})} />
        </Field>
        <Field label="장애인 등록여부"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.isDisabled} onChange={e=>setForm({...form,isDisabled:e.target.checked})} /><span>장애인(3개월) / 비장애인(1개월)</span></label></Field>
        <Field label="보장구 선택 *">
          <select className="input" value={form.itemId} onChange={e=>setForm({...form,itemId:e.target.value})}>
            {items.map(it => <option key={it.id} value={it.id}>{it.name} (잔여 {it.available})</option>)}
          </select>
        </Field>
        <Field label="수량 *"><input type="number" min={1} className="input" value={form.qty} onChange={e=>setForm({...form,qty:Number(e.target.value)})} /></Field>
      </div>
      <div className="text-sm bg-gray-50 rounded-xl p-3 mt-3">대여 시작일 <b>{form.startDate}</b> · 예상 반납일 <b>{dueDate}</b> (최대 {maxMonths}개월)</div>
      <button disabled={!canSubmit} onClick={submit} className={cls("btn w-full mt-3", canSubmit?"bg-gray-900 text-white":"bg-gray-300 text-gray-500 cursor-not-allowed")}>대여 신청</button>
    </Card>
  );
}

function ReturnPanel({ items, rentals, setRentals }) {
  // 빠른 반납: 이름 + 뒷번호 + 품목 선택으로 일치하는 대여를 반납 처리
  const [quick, setQuick] = useState({ name: "", phoneLast: "", itemId: items[0]?.id || "" });
  useEffect(()=>{
    if (!items.length) return;
    if (!items.find(i=>i.id===quick.itemId)) setQuick(q=>({...q, itemId: items[0].id}));
  },[items]);

  const doReturnById = (id) => setRentals(rs => rs.map(r => r.id === id ? { ...r, status: "반납", returnedAt: new Date().toISOString() } : r));
  const deleteById = (id) => setRentals(rs => rs.filter(r => r.id !== id));
  const clearHistory = () => {
    const has = rentals.some(r => r.status === "반납");
    if (!has) { alert("삭제할 반납 이력이 없습니다."); return; }
    if (!confirm("반납된 이력을 모두 삭제하시겠습니까? (대여 중 제외)")) return;
    setRentals(rs => rs.filter(r => r.status !== "반납"));
  };

  const doQuickReturn = () => {
    const norm = (s) => (s ?? "").toString().trim().toLowerCase();
    const nameN = norm(quick.name);
    const phoneN = (quick.phoneLast ?? "").toString().trim();
    const candidates = rentals
      .filter(r => r.status !== "반납")
      .filter(r => norm(r.name) === nameN && (r.phoneLast ?? "").toString().trim() === phoneN && r.itemId === quick.itemId);
    if (candidates.length === 0) { alert("일치하는 대여 건을 찾지 못했습니다. (공백/대소문자 무시 비교)"); return; }
    // 여러 건이면 최신 신청 건 우선
    const target = candidates.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""))[0];
    doReturnById(target.id);
    alert("반납 처리되었습니다.");
    setQuick({ name: "", phoneLast: "", itemId: items[0]?.id || "" });
  };

  // 정렬 상태(대여 중 / 전체 이력)
  const [sortActive, setSortActive] = useState("default"); // 기존 순서 유지
  const [sortHistory, setSortHistory] = useState("createdDesc"); // 기존 동작

  const active = useMemo(()=> {
    const base = rentals.filter(r => r.status !== "반납");
    switch (sortActive) {
      case "dueAsc":
        return [...base].sort((a,b)=> (a.dueDate||"").localeCompare(b.dueDate||""));
      case "dueDesc":
        return [...base].sort((a,b)=> (b.dueDate||"").localeCompare(a.dueDate||""));
      case "nameAsc":
        return [...base].sort((a,b)=> a.name.localeCompare(b.name));
      case "nameDesc":
        return [...base].sort((a,b)=> b.name.localeCompare(a.name));
      default:
        return base; // 기본: 기존 순서
    }
  }, [rentals, sortActive]);

  const history = useMemo(()=> {
    const base = [...rentals];
    switch (sortHistory) {
      case "createdAsc":
        return base.sort((a,b)=> (a.createdAt||"").localeCompare(b.createdAt||""));
      case "createdDesc":
        return base.sort((a,b)=> (b.createdAt||"").localeCompare(a.createdAt||""));
      case "dueAsc":
        return base.sort((a,b)=> (a.dueDate||"").localeCompare(b.dueDate||""));
      case "dueDesc":
        return base.sort((a,b)=> (b.dueDate||"").localeCompare(a.dueDate||""));
      case "nameAsc":
        return base.sort((a,b)=> a.name.localeCompare(b.name));
      case "nameDesc":
        return base.sort((a,b)=> b.name.localeCompare(a.name));
      default:
        return base;
    }
  }, [rentals, sortHistory]);

  return (
    <div className="space-y-4">
      <Card title="빠른 반납 처리">
        <div className="grid md:grid-cols-3 gap-2">
          <input className="input" placeholder="이름" value={quick.name} onChange={e=>setQuick({...quick, name:e.target.value})} />
          <input className="input" placeholder="연락처 뒷번호" value={quick.phoneLast} onChange={e=>setQuick({...quick, phoneLast:e.target.value})} />
          <select className="input" value={quick.itemId} onChange={e=>setQuick({...quick, itemId:e.target.value})}>
            {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
          </select>
        </div>
        <button className="btn w-full mt-2 bg-gray-900 text-white" onClick={doQuickReturn}>반납 처리</button>
      </Card>

      <Card title="반납 관리 (대여 중)" actions={(
        <select className="input w-auto" value={sortActive} onChange={e=>setSortActive(e.target.value)}>
          <option value="default">정렬: 기본</option>
          <option value="dueAsc">반납기한 임박순</option>
          <option value="dueDesc">반납기한 늦은순</option>
          <option value="nameAsc">이름↑</option>
          <option value="nameDesc">이름↓</option>
        </select>
      )}>
        <div className="space-y-2">
          {active.length === 0 && <div className="text-sm text-gray-600">대여 중인 건이 없습니다.</div>}
          {active.map(r => (
            <div key={r.id} className="flex items-center justify-between border rounded-xl p-3">
              <div className="text-sm">
                <div className="font-medium">{r.name} ({r.region}) · {items.find(i=>i.id===r.itemId)?.name || r.itemId}</div>
                <div className="text-gray-600">수량 {r.qty} · 시작 {r.startDate} · 반납기한 {r.dueDate} · 끝자리 {r.phoneLast}</div>
              </div>
              <button className="btn bg-gray-900 text-white" onClick={()=>doReturnById(r.id)}>반납</button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="반납 관리 (전체 이력)" actions={(
        <div className="flex items-center gap-2">
          <select className="input w-auto" value={sortHistory} onChange={e=>setSortHistory(e.target.value)}>
            <option value="createdDesc">정렬: 최신 신청순</option>
            <option value="createdAsc">오래된 신청순</option>
            <option value="dueAsc">반납기한 임박순</option>
            <option value="dueDesc">반납기한 늦은순</option>
            <option value="nameAsc">이름↑</option>
            <option value="nameDesc">이름↓</option>
          </select>
          <button className="btn bg-red-600 text-white" onClick={clearHistory}>이력 전체 삭제</button>
        </div>
      )}>
        <div className="space-y-2">
          {history.length === 0 && <div className="text-sm text-gray-600">대여 이력이 없습니다.</div>}
          {history.map(r => (
            <div key={r.id} className="flex items-center justify-between border rounded-xl p-3">
              <div className="text-sm">
                <div className="font-medium">{r.name} ({r.region}) · {items.find(i=>i.id===r.itemId)?.name || r.itemId}</div>
                <div className="text-gray-600">수량 {r.qty} · 시작 {r.startDate} · 반납기한 {r.dueDate} · 상태 {r.status}{r.returnedAt?` · 반납일 ${r.returnedAt.slice(0,10)}`:""}</div>
              </div>
              {r.status !== "반납" ? (
                <button className="btn bg-gray-900 text-white" onClick={()=>doReturnById(r.id)}>반납</button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">반납됨</span>
                  <button className="btn bg-red-600 text-white" onClick={()=>{ if(confirm('이 항목을 삭제할까요?')) deleteById(r.id); }}>삭제</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium">{label}</div>
      {children}
    </label>
  );
}

// 공통 스타일
const style = document.createElement("style");
style.innerHTML = `
  .input { border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 0.5rem 0.75rem; width: 100%; }
  .btn { padding: 0.5rem 0.75rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; }
`;
document.head.appendChild(style);

function FeatureList() {
  return (
    <Card title="기능 별 목록">
      <ul className="list-disc ml-5 space-y-1 text-sm">
        <li>실시간 현황 보기 (정렬: 잔여/총수량/이름)</li>
        <li>대여 신청 (이름·끝자리·지역·장애인 여부·품목·수량)</li>
        <li>빠른 반납 처리 (이름·끝자리·품목 일치, 공백/대소문자 무시)</li>
        <li>반납 관리 – 대여 중 목록(임박순 등 정렬)</li>
        <li>반납 관리 – 전체 이력(정렬/개별 삭제/전체 삭제/30일 자동 삭제)</li>
        <li>보장구 추가(+1/-1/삭제, 중복 코드 방지)</li>
      </ul>
    </Card>
  );
}

function ItemAddPanel({ items, setItems }) {
  const [draft, setDraft] = useState({ id: "", name: "", qty: 1 });
  const add = () => {
    if (!draft.id || !draft.name) { alert("코드와 이름을 입력하세요."); return; }
    if (items.some(i => i.id === draft.id)) { alert("중복된 코드입니다."); return; }
    setItems(xs => [...xs, { id: draft.id, name: draft.name, qty: Math.max(0, Number(draft.qty)||0) }]);
    setDraft({ id: "", name: "", qty: 1 });
  };
  const del = (id) => setItems(xs => xs.filter(x => x.id !== id));
  const inc = (id, n) => setItems(xs => xs.map(x => x.id === id ? { ...x, qty: Math.max(0, (x.qty||0) + n) } : x));

  return (
    <Card title="보장구 추가">
      <div className="grid md:grid-cols-3 gap-2 mb-3">
        <input className="input" placeholder="코드 (예: WCHAIR-004)" value={draft.id} onChange={e=>setDraft({...draft, id:e.target.value})} />
        <input className="input" placeholder="이름 (예: 전동휠체어)" value={draft.name} onChange={e=>setDraft({...draft, name:e.target.value})} />
        <input type="number" className="input" placeholder="수량" value={draft.qty} onChange={e=>setDraft({...draft, qty:e.target.value})} />
      </div>
      <button className="btn bg-gray-900 text-white" onClick={add}>추가</button>

      <div className="mt-5 grid md:grid-cols-2 gap-3">
        {items.map(it => (
          <div key={it.id} className="border rounded-xl p-4">
            <div className="flex justify-between">
              <div>
                <div className="font-semibold">{it.name}</div>
                <div className="text-sm text-gray-600">{it.id}</div>
              </div>
              <div className="text-sm">보유 {it.qty}</div>
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn" onClick={()=>inc(it.id, +1)}>+1</button>
              <button className="btn" onClick={()=>inc(it.id, -1)}>-1</button>
              <button className="btn !bg-red-600 text-white" onClick={()=>del(it.id)}>삭제</button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
