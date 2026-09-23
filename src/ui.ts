import { scoreHand } from "../shared/rules.ts";
import {
  TEAMS,
  partnerOf,
  playerAtSeat,
  teamNames,
  teamTotal,
  type GameState,
  type HandEntry,
  type PenaltyChip,
  type Seat,
} from "../shared/types.ts";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c
  ));
}

function posClass(abs: Seat, my: Seat): "s" | "e" | "n" | "w" {
  const r = ((abs - my + 4) % 4) as 0 | 1 | 2 | 3;
  return (["s", "e", "n", "w"] as const)[r];
}

function penaltyLabel(p: PenaltyChip): string {
  if (p.kind === "islek") return "İşlek atma +101";
  if (p.kind === "okey_atma") return "Okey atma +101";
  if (p.kind === "hatali_acma") return "Hatalı açma +101";
  const k = p.open === "cift" ? 20 : 10;
  return `Alıp açma ${p.tile}×${k} = +${p.tile * k}`;
}

export function renderHome(opts: {
  name: string;
  code: string;
  error: string;
}): string {
  return `
    <div class="top">
      <h1 class="brand">101 <span>Masa</span></h1>
    </div>
    <p class="sub">Ceza puanı tablosu. En düşük kazanır. Herkes telefonundan masaya oturur.</p>
    <div class="card stack" style="margin-top:16px">
      <label class="field">Adın
        <input data-field="name" maxlength="16" value="${esc(opts.name)}" placeholder="Ahmet" />
      </label>
      <button class="btn" data-act="create">Masa aç</button>
      <div class="row">
        <input data-field="code" maxlength="4" value="${esc(opts.code)}" placeholder="KOD" style="text-transform:uppercase;letter-spacing:.2em;font-weight:800" />
        <button class="btn secondary" data-act="join">Otur</button>
      </div>
      <button class="btn secondary" data-act="solo">Tek telefonda oyna</button>
      ${opts.error ? `<div class="toast">${esc(opts.error)}</div>` : ""}
    </div>
  `;
}

export function renderTable(opts: {
  game: GameState;
  youId: string;
  form: HandEntry;
  formSeat: Seat;
  guestName: string;
  toast: string;
  toastOk: boolean;
  solo: boolean;
  alip: { tile: number; open: "per" | "cift" } | null;
}): string {
  const { game, youId, form, formSeat } = opts;
  const me = game.players.find((p) => p.id === youId);
  const mySeat = (me?.seat ?? 0) as Seat;
  const host = game.hostId === youId;
  const entries = game.current
    ? (game.current.map((e, i) => (i === formSeat ? form : e)) as [
        HandEntry,
        HandEntry,
        HandEntry,
        HandEntry,
      ])
    : null;
  const preview = entries ? scoreHand(entries) : game.totals;
  const showTotals = game.phase !== "scoring" ? game.totals : preview;

  const a = teamTotal(showTotals, TEAMS[0]);
  const b = teamTotal(showTotals, TEAMS[1]);
  const leadA = a < b;
  const leadB = b < a;
  const diff = Math.abs(a - b);

  const seats = ([0, 1, 2, 3] as Seat[])
    .map((seat) => {
      const p = playerAtSeat(game, seat);
      const cls = [
        "seat",
        posClass(seat, mySeat),
        p ? "filled" : "",
        me?.seat === seat ? "me" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const partner = partnerOf(seat);
      const tag = game.phase === "lobby" ? "button" : "div";
      return `
        <${tag} class="${cls}" ${game.phase === "lobby" ? `data-act="sit" data-seat="${seat}"` : ""}>
          <div class="who">${p ? esc(p.name) : "Boş koltuk"}</div>
          <div class="meta">
            ${p ? `<span class="status-dot ${p.connected || p.guest ? "on" : ""}"></span>` : ""}
            ${p?.guest ? "misafir · " : ""}${p ? `eş: ${esc(playerAtSeat(game, partner)?.name ?? "?")}` : "dokun, otur"}
          </div>
        </${tag}>`;
    })
    .join("");

  const board = `
    <div class="card">
      <div class="board">
        <div class="team ${leadA ? "lead" : ""}">
          <div>
            <div class="tiny">Takım</div>
            <div>${esc(teamNames(game, TEAMS[0]))}</div>
            <div class="tiny">${esc(playerAtSeat(game, TEAMS[0][0])?.name ?? "?")} ${showTotals[TEAMS[0][0]]} · ${esc(playerAtSeat(game, TEAMS[0][1])?.name ?? "?")} ${showTotals[TEAMS[0][1]]}</div>
          </div>
          <div class="pts">${a}</div>
        </div>
        <div class="team ${leadB ? "lead" : ""}">
          <div>
            <div class="tiny">Takım</div>
            <div>${esc(teamNames(game, TEAMS[1]))}</div>
            <div class="tiny">${esc(playerAtSeat(game, TEAMS[1][0])?.name ?? "?")} ${showTotals[TEAMS[1][0]]} · ${esc(playerAtSeat(game, TEAMS[1][1])?.name ?? "?")} ${showTotals[TEAMS[1][1]]}</div>
          </div>
          <div class="pts">${b}</div>
        </div>
        <div class="diff">${
          diff === 0 ? "Fark yok" : `${esc(leadA ? teamNames(game, TEAMS[0]) : teamNames(game, TEAMS[1]))} önde ${diff}`
        }${game.phase === "scoring" ? " · canlı" : ""} · ${game.history.length} el</div>
      </div>
    </div>`;

  const people = game.phase !== "scoring" ? "" : `
    <div class="chips" style="margin-bottom:10px">
      ${([0, 1, 2, 3] as Seat[])
        .map((s) => {
          const p = playerAtSeat(game, s);
          return `<button class="chip ${formSeat === s ? "on" : ""}" data-act="form-seat" data-seat="${s}">${esc(p?.name ?? `Koltuk ${s + 1}`)}</button>`;
        })
        .join("")}
    </div>`;

  return `
    <div class="top">
      <h1 class="brand">101 <span>Masa</span></h1>
      <div class="tiny">${opts.solo ? "tek telefon" : "eşler karşılıklı"}${host ? " · sahipsin" : ""}</div>
    </div>
    <div class="table">
      ${seats}
      <div class="felt">
        <div>
          <div class="tiny">oda</div>
          <div class="code">${esc(game.code)}</div>
          ${opts.solo ? "" : `<button class="btn secondary" data-act="copy" style="margin-top:8px;padding:8px 10px">Linki kopyala</button>`}
        </div>
      </div>
    </div>
    ${board}
    ${
      game.phase === "lobby"
        ? renderLobby(host, opts.guestName)
        : game.phase === "playing"
          ? renderPlaying(host, game.history.length)
          : `${people}${renderForm(form, formSeat, host || me?.seat === formSeat, { host, alip: opts.alip })}`
    }
    ${
      opts.toast
        ? `<div class="toast ${opts.toastOk ? "ok-toast" : ""}">${esc(opts.toast)}</div>`
        : ""
    }
  `;
}

function renderLobby(host: boolean, guestName: string): string {
  if (!host) {
    return `<div class="card"><p class="sub">Koltuk seç, masa sahibinin başlamasını bekle.</p></div>`;
  }
  return `
    <div class="card stack">
      <p class="sub">Boş koltuğa dokunup sen otur. Telefonsuz arkadaş için isim yaz.</p>
      <label class="field">Misafir adı
        <input data-field="guestName" maxlength="16" value="${esc(guestName)}" placeholder="Can" />
      </label>
      <div class="chips">
        ${([0, 1, 2, 3] as Seat[])
          .map(
            (s) =>
              `<button class="chip" data-act="guest" data-seat="${s}">Koltuk ${s + 1}'e yaz</button>`,
          )
          .join("")}
      </div>
      <button class="btn" data-act="start">Oyunu başlat</button>
    </div>`;
}

function renderPlaying(host: boolean, n: number): string {
  return `
    <div class="card stack">
      <p class="sub">${n + 1}. el. Destek bitince veya biri bitince masa sahibi basar.</p>
      ${host ? `<button class="btn" data-act="end-hand">El bitti</button>
        <button class="btn secondary" data-act="reset">Skorları sıfırla</button>` : `<p class="tiny">El bitince form açılacak.</p>`}
    </div>`;
}

function renderForm(
  form: HandEntry,
  seat: Seat,
  canEdit: boolean,
  opts: { host: boolean; alip: { tile: number; open: "per" | "cift" } | null },
): string {
  const disabled = canEdit ? "" : "disabled";
  const open = form.open;
  return `
    <div class="card stack">
      <div class="tiny">Koltuk ${seat + 1} · eş ${partnerOf(seat) + 1}</div>
      <div class="chips">
        <button class="chip ${open === "none" ? "on" : ""}" data-act="open" data-v="none" ${disabled}>Açmadım</button>
        <button class="chip ${open === "per" ? "on" : ""}" data-act="open" data-v="per" ${disabled}>Per</button>
        <button class="chip ${open === "cift" ? "on" : ""}" data-act="open" data-v="cift" ${disabled}>Çift</button>
      </div>
      ${
        open !== "none"
          ? `
        <label class="field">Kalan taş toplamı (okey yüzü dahil)
          <input data-field="remaining" inputmode="numeric" value="${form.remaining}" ${disabled} />
        </label>
        <div class="field">Elde okey
          <div class="step">
            <button data-act="okey" data-d="-1" ${disabled}>−</button>
            <strong>${form.okeyCount}</strong>
            <button data-act="okey" data-d="1" ${disabled}>+</button>
          </div>
        </div>`
          : ""
      }
      ${
        open === "per"
          ? `<label class="field">İlk açış toplamı (yüz)
              <input data-field="openingValue" inputmode="numeric" value="${form.openingValue ?? ""}" placeholder="151" ${disabled} />
            </label>`
          : ""
      }
      ${
        open === "cift"
          ? `<label class="field">İlk açışta çift sayısı
              <input data-field="pairCount" inputmode="numeric" value="${form.pairCount ?? ""}" placeholder="5" ${disabled} />
            </label>`
          : ""
      }
      <div class="chips">
        <button class="chip ${form.finished ? "on" : ""}" data-act="toggle" data-k="finished" ${disabled}>Ben bittim</button>
        <button class="chip ${form.elden ? "on" : ""}" data-act="toggle" data-k="elden" ${disabled}>Elden</button>
        <button class="chip ${form.okeyFinish ? "on" : ""}" data-act="toggle" data-k="okeyFinish" ${disabled}>Okeyle bitti</button>
      </div>
      <div class="tiny">Cezalar</div>
      <div class="chips">
        <button class="chip" data-act="chip" data-k="islek" ${disabled}>İşlek</button>
        <button class="chip" data-act="chip" data-k="okey_atma" ${disabled}>Okey attım</button>
        <button class="chip" data-act="chip" data-k="hatali_acma" ${disabled}>Hatalı açma</button>
        <button class="chip" data-act="chip" data-k="alip_acma" ${disabled}>Alıp açma</button>
      </div>
      <div class="list">
        ${form.penalties
          .map(
            (p, i) =>
              `<div class="penalty"><span>${esc(penaltyLabel(p))}</span>
                <button class="chip" data-act="del-chip" data-i="${i}" ${disabled}>sil</button></div>`,
          )
          .join("")}
      </div>
      ${
        opts.alip
          ? `<div class="card" style="margin:0">
              <div class="tiny">Alınan taş</div>
              <div class="chips">
                ${Array.from({ length: 13 }, (_, i) => i + 1)
                  .map(
                    (n) =>
                      `<button class="chip ${opts.alip?.tile === n ? "on" : ""}" data-act="alip-tile" data-n="${n}">${n}</button>`,
                  )
                  .join("")}
              </div>
              <div class="chips" style="margin-top:8px">
                <button class="chip ${opts.alip.open === "per" ? "on" : ""}" data-act="alip-open" data-v="per">Per ×10</button>
                <button class="chip ${opts.alip.open === "cift" ? "on" : ""}" data-act="alip-open" data-v="cift">Çift ×20</button>
              </div>
              <div class="row" style="margin-top:8px">
                <button class="btn" data-act="alip-ok">Ekle</button>
                <button class="btn secondary" data-act="alip-cancel">Vazgeç</button>
              </div>
            </div>`
          : ""
      }
      ${canEdit ? `<button class="btn" data-act="submit">Kaydet</button>` : ""}
      ${opts.host ? `<button class="btn" data-act="lock">Puanı yaz / kilitle</button>` : `<p class="tiny">Kaydı bas, sonra masa sahibi kilitler.</p>`}
    </div>
    <p class="tiny">Yanlışsa koltuğu seçip düzelt, tekrar kaydet.</p>
  `;
}
