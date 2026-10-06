import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, BedDouble, Layers } from 'lucide-react';
import { roomMap, occupancy } from '@basera/domain';
import { useApp } from '../../app/store.jsx';
import { useI18n } from '../../app/i18n.jsx';
import { useRouter } from '../../app/router.jsx';
import { useUi, Modal, Input, Empty, Money, useForm } from '../../ui/kit.jsx';

function RoomForm({ room, onClose }) {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const [f, set] = useForm(room ? { number: room.number, floor: room.floor, beds: room.beds, rent: room.rent, ac: room.ac, attachedBath: room.attachedBath, meterNumber: room.meterNumber } : { number: '', floor: 1, beds: 2, rent: '', ac: false, attachedBath: false, meterNumber: '' });
  const save = async () => {
    const payload = { ...f, floor: Number(f.floor), beds: Number(f.beds), rent: Number(f.rent) };
    if (await ui.run(() => app.dispatch(room ? { type: 'room.update', payload: { roomId: room.id, ...payload } } : { type: 'room.add', payload }), t('toast.saved'))) onClose();
  };
  return (
    <Modal title={room ? t('rooms.edit', { number: room.number }) : t('rooms.add')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save} disabled={!f.number || f.rent === ''} data-testid="room-save">{t('common.save')}</button></>}>
      <div className="form-grid">
        <Input id="room-number" label={t('field.roomNumber')} value={f.number} onChange={set('number')} />
        <Input id="room-floor" label={t('field.floor')} type="number" min="0" value={f.floor} onChange={set('floor')} hint={t('rooms.floorHint')} />
        <Input id="room-beds" label={t('field.beds')} type="number" min="1" max="12" value={f.beds} onChange={set('beds')} />
        <Input id="room-rent" label={t('field.rentPerBed')} type="number" min="0" value={f.rent} onChange={set('rent')} />
        <Input id="room-meter" full label={t('field.meterNumber')} value={f.meterNumber} onChange={set('meterNumber')} />
        <label className="check"><input type="checkbox" checked={f.ac} onChange={(e) => set('ac')(e.target.checked)} />{t('rooms.ac')}</label>
        <label className="check"><input type="checkbox" checked={f.attachedBath} onChange={(e) => set('attachedBath')(e.target.checked)} />{t('rooms.bath')}</label>
      </div>
    </Modal>
  );
}

function BulkForm({ onClose }) {
  const app = useApp();
  const { t } = useI18n();
  const ui = useUi();
  const [f, set] = useForm({ floors: 1, roomsPerFloor: 4, beds: 2, rent: '', startFloor: 1 });
  const save = async () => {
    const res = await ui.run(() => app.dispatch({ type: 'room.addMany', payload: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])) }));
    if (res) { ui.toast(t('rooms.addedMany', { n: res.roomIds.length })); onClose(); }
  };
  return (
    <Modal title={t('rooms.addMany')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save} disabled={f.rent === ''}>{t('common.add')}</button></>}>
      <div className="form-grid">
        <Input id="bulk-start" label={t('rooms.startFloor')} type="number" min="0" value={f.startFloor} onChange={set('startFloor')} />
        <Input id="bulk-floors" label={t('field.floors')} type="number" min="1" value={f.floors} onChange={set('floors')} />
        <Input id="bulk-per" label={t('field.roomsPerFloor')} type="number" min="1" value={f.roomsPerFloor} onChange={set('roomsPerFloor')} />
        <Input id="bulk-beds" label={t('field.bedsPerRoom')} type="number" min="1" value={f.beds} onChange={set('beds')} />
        <Input id="bulk-rent" full label={t('field.rentPerBed')} type="number" min="0" value={f.rent} onChange={set('rent')} hint={t('rooms.bulkHint')} />
      </div>
    </Modal>
  );
}

export default function Rooms() {
  const app = useApp();
  const { state, today } = app;
  const { t } = useI18n();
  const ui = useUi();
  const { navigate } = useRouter();
  const [form, setForm] = useState(null);
  const floors = useMemo(() => roomMap(state, today), [state, today]);
  const occ = occupancy(state);
  const bedClass = (b) => { if (!b.tenant) return 'free'; const base = b.ledger.overdue > 0 ? 'late' : b.ledger.net > 0 ? 'due' : 'paid'; return `${base}${b.tenant.status === 'notice' ? ' notice' : ''}`; };
  const remove = async (room) => { if (await ui.confirm({ title: t('rooms.removeTitle', { number: room.number }), body: t('rooms.removeBody'), danger: true, action: t('common.remove') })) ui.run(() => app.dispatch({ type: 'room.remove', payload: { roomId: room.id } }), t('toast.removed')); };
  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>{t('nav.rooms')}</h1><p className="muted">{t('rooms.summary', { rooms: occ.rooms, beds: occ.beds, vacant: occ.vacant })}</p></div>
        <div className="row wrap"><button className="btn" onClick={() => setForm('bulk')}><Layers />{t('rooms.addMany')}</button><button className="btn primary" onClick={() => setForm('new')} data-testid="room-add"><Plus />{t('rooms.add')}</button></div></div>
      {state.rooms.length === 0 ? <div className="card"><Empty icon={BedDouble} title={t('rooms.emptyTitle')} body={t('rooms.emptyBody')} /></div> : (<>
        <div className="legend"><span><i style={{ background: 'var(--good-soft)' }} />{t('rooms.legendPaid')}</span><span><i style={{ background: 'var(--warn-soft)' }} />{t('rooms.legendDue')}</span><span><i style={{ background: 'var(--bad-soft)' }} />{t('rooms.legendLate')}</span><span><i style={{ border: '1px dashed var(--line-strong)' }} />{t('rooms.legendFree')}</span><span><i style={{ boxShadow: 'inset 0 -3px 0 var(--info)', background: 'var(--sunken)' }} />{t('val.notice')}</span></div>
        {floors.map(({ floor, rooms }) => (
          <section key={floor} className="stack">
            <p className="eyebrow">{floor === 0 ? t('rooms.ground') : t('rooms.floorN', { n: floor })}</p>
            <div className="floor">{rooms.map((room) => (
              <div className="room" key={room.id} data-testid={`room-${room.number}`}>
                <div className="row between"><span><b className="num">{room.number}</b> <span className="small muted">· <Money value={room.rent} />{room.ac ? ` · ${t('rooms.acShort')}` : ''}</span></span>
                  <span className="row" style={{ gap: 0 }}><button className="icon-btn" aria-label={t('common.edit')} onClick={() => setForm(room)}><Pencil /></button>{room.occupants.length === 0 && <button className="icon-btn" aria-label={t('common.remove')} onClick={() => remove(room)}><Trash2 /></button>}</span></div>
                <div className="beds">{room.beds.map((b) => (
                  <button key={b.label} className={`bed ${bedClass(b)}`} onClick={() => navigate(b.tenant ? `/residents/${b.tenant.id}` : `/residents/new?room=${room.id}&bed=${b.label}`)} title={b.tenant ? b.tenant.name : t('rooms.addHere')}>
                    <b>{b.label}</b><span>{b.tenant ? b.tenant.name.split(' ')[0] : `+ ${t('rooms.free')}`}</span></button>))}</div>
              </div>))}</div>
          </section>))}
      </>)}
      {form === 'bulk' && <BulkForm onClose={() => setForm(null)} />}
      {form && form !== 'bulk' && <RoomForm room={form === 'new' ? null : form} onClose={() => setForm(null)} />}
    </div>
  );
}
