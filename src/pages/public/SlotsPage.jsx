import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { purchaseStoreItem, setPrizePaid } from '../../lib/slots';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const SPIN_COOLDOWN_SECS = 4; // max 15 spins/min — change here to adjust

const ALL_SYMBOLS = ['masterball','pokeball','greatball','ultraball','pikachu','eevee','rare_candy','potion','berry'];

const SYMBOL_LABELS = {
  masterball: 'Masterball', pokeball: 'Pokeball', greatball: 'Greatball',
  ultraball: 'Ultraball', pikachu: 'Pikachu', eevee: 'Eevee',
  rare_candy: 'Rare Candy', potion: 'Potion', berry: 'Berry',
};

// Hardcoded symbol images served from the repo's public/images/slots/ folder.
// These are used on the reels and in the pay table.
const SYMBOL_IMAGES = {
  masterball: '/all-play/images/slots/masterball.png',
  pokeball:   '/all-play/images/slots/pokeball.png',
  greatball:  '/all-play/images/slots/greatball.png',
  ultraball:  '/all-play/images/slots/ultraball.png',
  pikachu:    '/all-play/images/slots/pikachu.png',
  eevee:      '/all-play/images/slots/eevee.png',
  rare_candy: '/all-play/images/slots/rarecandy.png',
  potion:     '/all-play/images/slots/potion.png',
  berry:      '/all-play/images/slots/berry.png',
};

// Symbol colors for spinning placeholder strips
const SYMBOL_COLORS = {
  masterball: '#9c27b0',
  pokeball:   '#e53935',
  greatball:  '#1565c0',
  ultraball:  '#f9a825',
  pikachu:    '#f57f17',
  eevee:      '#8d6e63',
  rare_candy: '#e91e63',
  potion:     '#43a047',
  berry:      '#6a1b9a',
};

// Animated spinning reel component
// Shows a blurred scrolling strip of colored blocks while spinning,
// then snaps to the actual symbol image on result.
function SpinningReel({ symbol, isSpinning, stopDelay, theme, getSymbolImg, SYMBOL_COLORS, ALL_SYMBOLS }) {
  const stripRef = React.useRef(null);
  const animRef  = React.useRef(null);
  const [stopped, setStopped] = React.useState(true);

  React.useEffect(() => {
    if (isSpinning) {
      setStopped(false);
      // Start CSS animation immediately
      if (stripRef.current) {
        stripRef.current.style.transition = 'none';
        stripRef.current.style.transform  = 'translateY(0px)';
      }
    } else {
      // Stop after delay for stagger effect
      const t = setTimeout(() => setStopped(true), stopDelay);
      return () => clearTimeout(t);
    }
  }, [isSpinning, stopDelay]);

  // Generate a fixed strip of 12 random colored blocks for the scroll
  const strip = React.useMemo(() => {
    const syms = [...ALL_SYMBOLS, ...ALL_SYMBOLS, ...ALL_SYMBOLS, ...ALL_SYMBOLS];
    // Shuffle
    for (let i = syms.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [syms[i], syms[j]] = [syms[j], syms[i]];
    }
    return syms.slice(0, 12);
  }, []); // only generate once per mount

  const BLOCK_H = 68; // height of each strip block in px

  return (
    <div style={{
      width: 120, height: 100,
      border: `2px solid ${theme}`,
      borderRadius: 10,
      overflow: 'hidden',
      position: 'relative',
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {!stopped ? (
        // Spinning: scrolling colored blocks
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <style>{`
            @keyframes reelScroll {
              0%   { transform: translateY(0); }
              100% { transform: translateY(-${BLOCK_H * strip.length / 2}px); }
            }
          `}</style>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            animation: `reelScroll ${0.35}s linear infinite`,
            filter: 'blur(2px)',
          }}>
            {[...strip, ...strip].map((sym, i) => (
              <div key={i} style={{
                height: BLOCK_H,
                minHeight: BLOCK_H,
                width: 120,
                background: SYMBOL_COLORS[sym] + '88',
                borderBottom: '2px solid rgba(0,0,0,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{
                  width: 32, height: 32,
                  borderRadius: '50%',
                  background: SYMBOL_COLORS[sym],
                  opacity: 0.7,
                }} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        // Stopped: show actual symbol
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 56 }}>
            {getSymbolImg(symbol, 48)}
          </div>
          <div style={{ fontSize: 11, color: '#ccc', marginTop: 2 }}>
            {symbol?.replace('_', ' ')}
          </div>
        </>
      )}
    </div>
  );
}


export default function SlotsPage() {
  const { eventId } = useParams();
  const { user, profile } = useAuth();

  const [config, setConfig] = useState(null);
  const [event, setEvent] = useState(null);
  const [players, setPlayers] = useState([]);
  const [myPlayer, setMyPlayer] = useState(null);
  const [storeItems, setStoreItems] = useState([]);
  const [prizeBoard, setPrizeBoard] = useState([]);
  const [payoutTable, setPayoutTable] = useState([]);
  const [recentSpins, setRecentSpins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Slot machine state
  const [reels, setReels] = useState(['pokeball', 'pokeball', 'pokeball']);
  const [spinState, setSpinState] = useState('idle');
  const [lastOutcome, setLastOutcome] = useState(null);
  const [spinError, setSpinError] = useState(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false); // reels stopping, outcome not yet shown
  const [cooldownLeft, setCooldownLeft] = useState(0); // seconds until next spin allowed
  const cooldownRef = React.useRef(null);

  // UI state
  const [activeTab, setActiveTab] = useState('machine');
  const [purchaseLoading, setPurchaseLoading] = useState(null);
  const [purchaseMsg, setPurchaseMsg] = useState(null);

  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner';

  // ─── Load data ───────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [evRes, cfgRes, playersRes, storeRes, prizesRes, payoutRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('slots_config').select('*').eq('event_id', eventId).single(),
        supabase.from('slots_players').select('*').eq('event_id', eventId).order('total_cpc_won', { ascending: false }),
        supabase.from('slots_store_items').select('*').eq('event_id', eventId).eq('is_active', true).order('cost_cpc'),
        supabase.from('slots_prize_board').select(`*, slots_players(display_name), slots_store_items(label)`).eq('event_id', eventId).order('purchased_at', { ascending: false }),
        supabase.from('slots_payout_table').select('*').eq('event_id', eventId).order('payout_cpc', { ascending: false }),
      ]);
      if (evRes.error) throw evRes.error;
      setEvent(evRes.data);
      setConfig(cfgRes.data);
      setPlayers(playersRes.data || []);
      setStoreItems(storeRes.data || []);
      setPrizeBoard(prizesRes.data || []);
      setPayoutTable(payoutRes.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  const loadMyPlayer = useCallback(async () => {
    if (!user) { setMyPlayer(null); return; }
    const { data } = await supabase.from('slots_players').select('*').eq('event_id', eventId).eq('profile_id', user.id).maybeSingle();
    setMyPlayer(data);
  }, [eventId, user]);

  const loadRecentSpins = useCallback(async (pid) => {
    if (!pid) return;
    const { data } = await supabase.from('slots_spins').select('*').eq('player_id', pid).order('spun_at', { ascending: false }).limit(10);
    setRecentSpins(data || []);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadMyPlayer(); }, [loadMyPlayer]);
  useEffect(() => { if (myPlayer) loadRecentSpins(myPlayer.id); }, [myPlayer, loadRecentSpins]);

  // ─── Realtime ─────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`slots-page-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots_players', filter: `event_id=eq.${eventId}` }, () => {
        loadAll(); loadMyPlayer();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots_prize_board', filter: `event_id=eq.${eventId}` }, () => {
        loadAll();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [eventId, loadAll, loadMyPlayer]);

  // ─── Spin ──────────────────────────────────────────────────────
  const handleSpin = async () => {
    if (!user || !myPlayer) return;
    if (myPlayer.slot_tokens < 1) { setSpinError('No tokens remaining.'); return; }
    if (isSpinning || cooldownLeft > 0) return;
    setIsSpinning(true);
    setSpinError(null);
    setLastOutcome(null);
    setSpinState('spinning');

    // Start cooldown immediately on spin press
    setCooldownLeft(SPIN_COOLDOWN_SECS);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldownLeft(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/slots-spin`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, player_id: myPlayer.id }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Spin failed');

      // Wait 800ms of spinning before starting stagger-stop sequence
      await new Promise(r => setTimeout(r, 800));

      // Set result reels now — SpinningReel will use them once stopped
      setReels(result.reels);

      // isSpinning → false triggers stagger: reel 1 stops at 0ms, reel 2 at 500ms, reel 3 at 1000ms
      // We reveal outcome after the last reel has stopped (1000ms + buffer)
      setIsRevealing(true);
      setIsSpinning(false);
      await new Promise(r => setTimeout(r, 1200));

      setIsRevealing(false);
      setLastOutcome(result);
      setSpinState('result_shown');



      await loadMyPlayer();
      if (myPlayer) await loadRecentSpins(myPlayer.id);
      await loadAll();
    } catch (e) {
      setSpinError(e.message);
      setSpinState('idle');

    } finally {
      setIsSpinning(false);
    }
  };

  // ─── Purchase ─────────────────────────────────────────────────
  const handlePurchase = async (item) => {
    if (!user || !myPlayer) return;
    if ((myPlayer.casino_prize_coins || 0) < item.cost_cpc) return;
    setPurchaseLoading(item.id);
    setPurchaseMsg(null);
    try {
      await purchaseStoreItem(eventId, myPlayer.id, item.id, user.id);
      setPurchaseMsg(`Purchased "${item.label}"!`);
      await loadMyPlayer();
      await loadAll();
    } catch (e) {
      setPurchaseMsg(`Error: ${e.message}`);
    } finally {
      setPurchaseLoading(null);
      setTimeout(() => setPurchaseMsg(null), 4000);
    }
  };

  // ─── Mark paid ────────────────────────────────────────────────
  const handleMarkPaid = async (entry, paid) => {
    if (!canManage) return;
    await setPrizePaid(eventId, entry.id, paid, user.id);
    await loadAll();
  };

  // ─── Symbol rendering ─────────────────────────────────────────
  // Always use the hardcoded repo images; no custom URL fallback for reels.
  const getSymbolImg = (sym, size = 48) => {
    const src = SYMBOL_IMAGES[sym];
    if (src) return <img src={src} alt={sym} style={{ width: size, height: size, objectFit: 'contain' }} />;
    return <span style={{ fontSize: size * 0.8, lineHeight: 1 }}>❓</span>;
  };

  const theme = config?.theme_color || '#c62828';

  if (loading) return <div style={styles.center}>Loading…</div>;
  if (error) return <div style={styles.center}>Error: {error}</div>;
  if (!config) return <div style={styles.center}>Event not found.</div>;

  const myTokens = myPlayer?.slot_tokens ?? 0;
  const myCpc = myPlayer?.casino_prize_coins ?? 0;
  const isWin = lastOutcome && lastOutcome.payout_cpc > 0;
  const isJackpot = lastOutcome?.payout_cpc >= 34045;

  return (
    <div style={{ ...styles.page, background: '#0a0a0f' }}>
      {/* ─── Header ─────────────────────────────────────── */}
      <div style={{ ...styles.header, borderBottomColor: theme }}>
        <div style={styles.headerLeft}>
          {config.banner_image_url
            ? <img src={config.banner_image_url} alt="banner" style={{ height: 48, borderRadius: 6 }} />
            : <div>
                <div style={{ ...styles.title, color: theme }}>{config.game_title || event?.name}</div>
                {config.game_subtitle && <div style={styles.subtitle}>{config.game_subtitle}</div>}
              </div>
          }
        </div>
        {user && myPlayer && (
          <div style={styles.balanceBar}>
            <div style={styles.balanceChip}>
              <span style={{ fontSize: 18 }}>🎟️</span>
              <span style={{ fontWeight: 700, fontSize: 18 }}>{myTokens.toLocaleString()}</span>
              <span style={{ fontSize: 11, opacity: 0.6 }}>tokens</span>
            </div>
            <div style={{ ...styles.balanceChip, background: 'rgba(212,175,55,0.15)', borderColor: '#d4af37' }}>
              <span style={{ fontSize: 18 }}>🪙</span>
              <span style={{ fontWeight: 700, fontSize: 18, color: '#d4af37' }}>{myCpc.toLocaleString()}</span>
              <span style={{ fontSize: 11, opacity: 0.6 }}>CPC</span>
            </div>
            <span style={{ fontSize: 12, opacity: 0.5 }}>as {myPlayer.display_name}</span>
          </div>
        )}
        {user && !myPlayer && (
          <div style={{ fontSize: 12, opacity: 0.5 }}>Not enrolled in this event</div>
        )}
        {!user && (
          <Link to="/admin" style={{ ...styles.btn, background: theme, textDecoration: 'none', fontSize: 13, padding: '6px 14px' }}>
            Log In to Spin
          </Link>
        )}
      </div>

      {/* ─── Nav tabs ───────────────────────────────────── */}
      <div style={styles.tabBar}>
        {[['machine','🎰 Slots'],['store','🛒 Store'],['board','🏅 Prize Board'],['leaderboard','🏆 Leaderboard'],['paytable','📋 Pay Table']].map(([id,label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            style={{ ...styles.tab, ...(activeTab===id ? { borderBottomColor: theme, color: '#fff' } : {}) }}>
            {label}
          </button>
        ))}
      </div>

      <div style={styles.content}>
        {/* ═══════════════ SLOT MACHINE ═══════════════════ */}
        {activeTab === 'machine' && (
          <div style={styles.machineWrap}>
            <div style={{ ...styles.cabinet, borderColor: theme, boxShadow: `0 0 40px ${theme}33, inset 0 0 60px rgba(0,0,0,0.5)` }}>
              <div style={{ ...styles.cabinetTop, background: theme }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>
                  {config.game_title || 'PokeNexus Slots'}
                </span>
              </div>

              {/* Reels — stagger-stop left to right for casino feel */}
              <div style={styles.reelWindow}>
                {reels.map((sym, i) => (
                  <SpinningReel
                    key={i}
                    symbol={sym}
                    isSpinning={isSpinning}
                    stopDelay={i * 500}
                    theme={theme}
                    getSymbolImg={getSymbolImg}
                    SYMBOL_COLORS={SYMBOL_COLORS}
                    ALL_SYMBOLS={ALL_SYMBOLS}
                  />
                ))}
              </div>

              <div style={{ ...styles.payline, borderColor: `${theme}88` }} />

              <div style={styles.resultBanner}>
                {(isSpinning || isRevealing) && <div style={{ color: '#888', fontSize: 14, letterSpacing: 2 }}>SPINNING…</div>}
                {!isSpinning && !isRevealing && lastOutcome && (
                  <div style={{
                    color: isJackpot ? '#FFD700' : isWin ? '#4CAF50' : '#888',
                    fontSize: isJackpot ? 22 : 16,
                    fontWeight: 700,
                    textShadow: isJackpot ? '0 0 20px #FFD700' : 'none',
                  }}>
                    {isJackpot ? '🏆 JACKPOT! 🏆' : isWin ? `+${lastOutcome.payout_cpc} CPC` : 'No Win'}
                  </div>
                )}
                {!isSpinning && !isRevealing && !lastOutcome && !spinError && (
                  <div style={{ color: '#555', fontSize: 12 }}>Press SPIN to play</div>
                )}
                {spinError && <div style={{ color: '#f44', fontSize: 13 }}>{spinError}</div>}
              </div>

              <div style={{ textAlign: 'center', paddingBottom: 20 }}>
                <button
                  onClick={handleSpin}
                  disabled={!user || !myPlayer || isSpinning || isRevealing || myTokens < 1 || cooldownLeft > 0}
                  title={!user ? 'Log in to spin' : !myPlayer ? 'Not enrolled' : myTokens < 1 ? 'No tokens' : 'Spin!'}
                  style={{
                    ...styles.spinBtn,
                    background: isSpinning ? '#333' : theme,
                    boxShadow: isSpinning ? 'none' : `0 0 20px ${theme}88`,
                    cursor: (!user || !myPlayer || myTokens < 1 || isSpinning || isRevealing || cooldownLeft > 0) ? 'not-allowed' : 'pointer',
                    opacity: (!user || !myPlayer || myTokens < 1 || cooldownLeft > 0) && !isSpinning && !isRevealing ? 0.5 : 1,
                  }}>
                  {isSpinning || isRevealing ? '⏳ SPINNING' : cooldownLeft > 0 ? `⏱ ${cooldownLeft}s` : '🎰 SPIN (1 🎟️)'}
                </button>
              </div>
            </div>

            {/* Recent spins */}
            {user && myPlayer && recentSpins.length > 0 && (
              <div style={styles.recentWrap}>
                <div style={{ ...styles.sectionTitle, color: theme }}>My Recent Spins</div>
                {recentSpins.map((spin, i) => (
                  <div key={i} style={styles.spinRow}>
                    <div style={styles.spinReels}>
                      {spin.reels?.map((s, j) => (
                        <span key={j} style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {getSymbolImg(s, 22)}
                        </span>
                      ))}
                    </div>
                    <div style={{ color: spin.payout_cpc > 0 ? '#4CAF50' : '#555', fontWeight: 600, minWidth: 60, textAlign: 'right' }}>
                      {spin.payout_cpc > 0 ? `+${spin.payout_cpc}` : '—'}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.4, minWidth: 80, textAlign: 'right' }}>
                      {new Date(spin.spun_at).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ PRIZE STORE ════════════════════ */}
        {activeTab === 'store' && (
          <div style={styles.panelWrap}>
            <div style={styles.panelHeader}>
              <span style={{ ...styles.sectionTitle, color: theme }}>🛒 Prize Store</span>
              {user && myPlayer && (
                <span style={{ fontSize: 13, color: '#d4af37' }}>Balance: {myCpc.toLocaleString()} 🪙 CPC</span>
              )}
            </div>
            {purchaseMsg && (
              <div style={{ ...styles.flashMsg, background: purchaseMsg.startsWith('Error') ? '#f443361a' : '#4caf501a', borderColor: purchaseMsg.startsWith('Error') ? '#f44' : '#4caf50' }}>
                {purchaseMsg}
              </div>
            )}
            {storeItems.length === 0 && <div style={styles.empty}>No items in the store yet.</div>}
            <div style={styles.storeGrid}>
              {storeItems.map(item => {
                const canAfford = myPlayer && myCpc >= item.cost_cpc;
                const soldOut = item.quantity_remaining !== null && item.quantity_remaining <= 0;
                return (
                  <div key={item.id} style={{ ...styles.storeCard, borderColor: soldOut ? '#333' : theme, opacity: soldOut ? 0.5 : 1 }}>
                    {item.image_url && <img src={item.image_url} alt={item.label} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: '8px 8px 0 0' }} />}
                    <div style={styles.storeCardBody}>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{item.label}</div>
                      {item.description && <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>{item.description}</div>}
                      {item.pays_out_slot_tokens && (
                        <div style={{ fontSize: 12, color: '#90CAF9', marginBottom: 6 }}>+{item.pays_out_slot_tokens} 🎟️ tokens</div>
                      )}
                      {item.quantity_remaining !== null && (
                        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6 }}>
                          {soldOut ? 'Sold out' : `${item.quantity_remaining} remaining`}
                        </div>
                      )}
                      <div style={{ ...styles.storePrice, color: '#d4af37' }}>
                        🪙 {item.cost_cpc.toLocaleString()} CPC
                      </div>
                      <button
                        onClick={() => handlePurchase(item)}
                        disabled={!user || !myPlayer || !canAfford || soldOut || purchaseLoading === item.id}
                        style={{
                          ...styles.purchaseBtn,
                          background: (soldOut || !canAfford) ? '#333' : theme,
                          cursor: (!user || !myPlayer || !canAfford || soldOut) ? 'not-allowed' : 'pointer',
                          opacity: (!user || !myPlayer || !canAfford || soldOut) ? 0.5 : 1,
                        }}>
                        {purchaseLoading === item.id ? '…' : soldOut ? 'Sold Out' : !user ? 'Log In' : !myPlayer ? 'Not Enrolled' : !canAfford ? 'Insufficient CPC' : 'Purchase'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══════════════ PRIZE BOARD ════════════════════ */}
        {activeTab === 'board' && (
          <div style={styles.panelWrap}>
            <div style={styles.panelHeader}>
              <span style={{ ...styles.sectionTitle, color: theme }}>🏅 Prize Board</span>
            </div>
            {prizeBoard.length === 0 && <div style={styles.empty}>No prizes claimed yet.</div>}
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Player','Prize','Cost','Date','Status', canManage && 'Mark'].filter(Boolean).map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prizeBoard.map(entry => (
                  <tr key={entry.id} style={{ opacity: entry.paid ? 0.5 : 1 }}>
                    <td style={styles.td}>{entry.slots_players?.display_name || '—'}</td>
                    <td style={styles.td}>{entry.slots_store_items?.label || '—'}</td>
                    <td style={styles.td}>🪙 {entry.cost_cpc_at_purchase}</td>
                    <td style={styles.td}>{new Date(entry.purchased_at).toLocaleDateString()}</td>
                    <td style={styles.td}>
                      <span style={{ color: entry.paid ? '#4CAF50' : '#888', fontSize: 12 }}>
                        {entry.paid ? '✅ Fulfilled' : '⏳ Pending'}
                      </span>
                    </td>
                    {canManage && (
                      <td style={styles.td}>
                        <button onClick={() => handleMarkPaid(entry, !entry.paid)}
                          style={{ ...styles.smallBtn, background: entry.paid ? '#555' : '#4CAF50' }}>
                          {entry.paid ? 'Unmark' : 'Fulfill'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══════════════ LEADERBOARD ════════════════════ */}
        {activeTab === 'leaderboard' && (
          <div style={styles.panelWrap}>
            <div style={styles.panelHeader}>
              <span style={{ ...styles.sectionTitle, color: theme }}>🏆 Leaderboard</span>
            </div>
            {players.length === 0 && <div style={styles.empty}>No players yet.</div>}
            <table style={styles.table}>
              <thead>
                <tr>
                  {['#','Player','Spins','Total CPC Won','Jackpots','Tokens','CPC Balance'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => (
                  <tr key={p.id} style={{ background: myPlayer?.id === p.id ? `${theme}15` : 'transparent' }}>
                    <td style={{ ...styles.td, color: '#888', width: 30 }}>{i + 1}</td>
                    <td style={styles.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {p.avatar_url
                          ? <img src={p.avatar_url} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                          : <div style={{ width: 28, height: 28, borderRadius: '50%', background: p.color || theme, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                              {p.display_name?.[0]?.toUpperCase()}
                            </div>
                        }
                        {p.display_name}
                        {myPlayer?.id === p.id && <span style={{ fontSize: 10, color: theme }}>YOU</span>}
                      </div>
                    </td>
                    <td style={styles.tdNum}>{p.total_spins?.toLocaleString()}</td>
                    <td style={{ ...styles.tdNum, color: '#d4af37' }}>🪙 {p.total_cpc_won?.toLocaleString()}</td>
                    <td style={{ ...styles.tdNum, color: p.jackpots_hit > 0 ? '#FFD700' : '#555' }}>
                      {p.jackpots_hit > 0 ? `🏆 ${p.jackpots_hit}` : '—'}
                    </td>
                    <td style={styles.tdNum}>🎟️ {p.slot_tokens?.toLocaleString()}</td>
                    <td style={{ ...styles.tdNum, color: '#d4af37' }}>🪙 {p.casino_prize_coins?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ═══════════════ PAY TABLE ══════════════════════ */}
        {activeTab === 'paytable' && (
          <div style={styles.panelWrap}>
            <div style={styles.panelHeader}>
              <span style={{ ...styles.sectionTitle, color: theme }}>📋 Pay Table</span>
              <span style={{ fontSize: 12, color: '#888' }}>~87% RTP · Reel-driven · Near-miss reel 3</span>
            </div>

            <div style={styles.rulesBox}>
              <div style={styles.ruleRow}>
                <span style={styles.ruleIcon}>3️⃣</span>
                <span><strong>Three of a Kind</strong> — all 3 reels show the same symbol</span>
              </div>
              <div style={styles.ruleRow}>
                <span style={styles.ruleIcon}>2️⃣</span>
                <span><strong>Left Pair (1+2)</strong> — reels 1 and 2 match, reel 3 differs — higher payout</span>
              </div>
              <div style={styles.ruleRow}>
                <span style={styles.ruleIcon}>2️⃣</span>
                <span><strong>Right Pair (2+3)</strong> — reels 2 and 3 match, reel 1 differs — lower payout</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.4, paddingLeft: 26 }}>Any consecutive pair pays. Three of a kind always takes priority.</div>
            </div>

            <table style={styles.table}>
              <thead>
                <tr>
                  {['Outcome','Symbols','Type','Payout (CPC)'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payoutTable.map(row => (
                  <tr key={row.id} style={{ background: row.is_jackpot ? '#FFD70010' : 'transparent' }}>
                    <td style={{ ...styles.td, color: row.is_jackpot ? '#FFD700' : '#ccc', fontWeight: row.is_jackpot ? 700 : 400 }}>
                      {row.is_jackpot && '🏆 '}{row.label}
                    </td>
                    <td style={styles.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {(row.symbols || []).map((s, i) => (
                          <span key={i}>{getSymbolImg(s, 24)}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ ...styles.td, fontSize: 12 }}>
                      {row.category === 'jackpot' && <span style={{ color: '#FFD700' }}>Jackpot</span>}
                      {row.category === 'three_of_a_kind' && <span style={{ color: '#90CAF9' }}>3 of a Kind</span>}
                      {row.category === 'two_of_a_kind_left' && <span style={{ color: '#aaa' }}>Left Pair <span style={{ opacity: 0.5 }}>(reels 1+2)</span></span>}
                      {row.category === 'two_of_a_kind_right' && <span style={{ color: '#888' }}>Right Pair <span style={{ opacity: 0.5 }}>(reels 2+3)</span></span>}
                    </td>
                    <td style={{ ...styles.tdNum, color: row.payout_cpc > 100 ? '#FFD700' : row.payout_cpc > 10 ? '#90CAF9' : '#ccc', fontWeight: 700 }}>
                      {row.payout_cpc.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '12px 0', fontSize: 12, opacity: 0.4, textAlign: 'center' }}>
              ~87% RTP — per spin wager is 5 CPC (1 token). For every 100 CPC wagered (~20 spins), ~87 CPC is returned on average over a large sample. ~23% win rate. Reels spin independently; reel 3 has reduced rare-symbol frequency to create near-miss tension.
            </div>
          </div>
        )}
      </div>


    </div>
  );
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

const styles = {
  page: { minHeight: '100vh', color: '#e0e0e0', fontFamily: "'Segoe UI', sans-serif" },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#888' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', borderBottom: '2px solid', background: '#111' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: 800, letterSpacing: 1 },
  subtitle: { fontSize: 13, opacity: 0.6 },
  balanceBar: { display: 'flex', alignItems: 'center', gap: 10 },
  balanceChip: { display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: '6px 14px' },
  tabBar: { display: 'flex', background: '#111', borderBottom: '1px solid #222', padding: '0 12px', gap: 4 },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#666', padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500, transition: 'all 0.15s' },
  content: { maxWidth: 960, margin: '0 auto', padding: 24 },
  machineWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 },
  cabinet: { width: '100%', maxWidth: 520, borderRadius: 16, border: '2px solid', background: '#111', overflow: 'hidden' },
  cabinetTop: { padding: '10px 20px', textAlign: 'center', color: '#fff', fontWeight: 700 },
  reelWindow: { display: 'flex', justifyContent: 'center', gap: 12, padding: '24px 20px 12px' },
  reel: { width: 120, height: 100, border: '2px solid', borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transition: 'background 0.3s' },
  reelInner: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: 56 },
  reelLabel: { fontSize: 11, marginTop: 4 },
  payline: { height: 2, borderTop: '1px dashed', margin: '0 20px', opacity: 0.4 },
  resultBanner: { height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinBtn: { padding: '14px 48px', fontSize: 16, fontWeight: 800, color: '#fff', border: 'none', borderRadius: 30, letterSpacing: 1, transition: 'all 0.2s' },
  recentWrap: { width: '100%', maxWidth: 520, background: '#111', borderRadius: 10, padding: 16 },
  spinRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid #1a1a1a' },
  spinReels: { display: 'flex', gap: 6, flex: 1, alignItems: 'center' },
  panelWrap: { width: '100%' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 700 },
  flashMsg: { padding: '10px 16px', borderRadius: 8, border: '1px solid', marginBottom: 16, fontSize: 13 },
  rulesBox: { background: '#111', border: '1px solid #222', borderRadius: 10, padding: '14px 18px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 },
  ruleRow: { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#ccc' },
  ruleIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  storeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 },
  storeCard: { background: '#111', borderRadius: 10, border: '1px solid', overflow: 'hidden' },
  storeCardBody: { padding: 14 },
  storePrice: { fontWeight: 700, fontSize: 15, marginBottom: 10 },
  purchaseBtn: { width: '100%', padding: '8px', fontSize: 13, fontWeight: 600, color: '#fff', border: 'none', borderRadius: 6 },
  empty: { textAlign: 'center', color: '#444', padding: '40px 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #222', color: '#888', fontWeight: 600, fontSize: 12 },
  td: { padding: '10px 12px', borderBottom: '1px solid #1a1a1a', color: '#ccc' },
  tdNum: { padding: '10px 12px', borderBottom: '1px solid #1a1a1a', textAlign: 'right', color: '#ccc' },
  smallBtn: { padding: '4px 10px', fontSize: 11, fontWeight: 600, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#fff', border: 'none', cursor: 'pointer' },
};
