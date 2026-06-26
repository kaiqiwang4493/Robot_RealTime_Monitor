import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import type { CellEvent } from '../models';

interface EventsResponse {
  events: CellEvent[];
  total: number;
}

@Component({
  selector: 'app-history',
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hist-header">
      <p class="hist-eyebrow">EVENT HISTORY</p>
      <small>Server buffer (up to 1000 events) · REST API · 10 s poll</small>
    </div>

    <div class="filter-bar">
      <select [ngModel]="filterRobot()" (ngModelChange)="filterRobot.set($event)">
        <option value="">All sources</option>
        <option value="ARM-A">ARM-A</option>
        <option value="ARM-B">ARM-B</option>
        <option value="CELL">CELL</option>
        <option value="CONVEYOR">CONVEYOR</option>
        <option value="PROCESS">PROCESS</option>
        <option value="SAFETY">SAFETY</option>
      </select>

      <select [ngModel]="filterType()" (ngModelChange)="filterType.set($event)">
        <option value="">All types</option>
        <option value="info">info</option>
        <option value="warning">warning</option>
        <option value="error">error</option>
      </select>

      <span class="filter-label">From</span>
      <input type="datetime-local" [ngModel]="filterFrom()" (ngModelChange)="filterFrom.set($event)" />

      <span class="filter-label">To</span>
      <input type="datetime-local" [ngModel]="filterTo()" (ngModelChange)="filterTo.set($event)" />

      <button class="clear-btn" (click)="clearFilters()">✕ Clear</button>

      <span class="result-count">{{ filteredEvents().length }} results</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-ts">Timestamp</th>
            <th class="col-src">Source</th>
            <th class="col-sev">Severity</th>
            <th class="col-code">Code</th>
            <th class="col-msg">Message</th>
          </tr>
        </thead>
        <tbody>
          @for (event of pagedEvents(); track event.id) {
            <tr>
              <td class="ts">{{ event.timestamp | date:'yyyy-MM-dd HH:mm:ss' }}</td>
              <td class="src">{{ event.source }}</td>
              <td><span class="badge" [class]="event.severity">{{ event.severity }}</span></td>
              <td class="code">{{ event.code }}</td>
              <td class="msg">{{ event.message }}</td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="empty">No events match the current filters.</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (totalPages() > 1) {
      <div class="pagination">
        <span class="page-info">
          Showing {{ pageStart() }}–{{ pageEnd() }} of {{ filteredEvents().length }}
        </span>

        <div class="page-btns">
          @for (p of visiblePages(); track p) {
            @if (p === -1) {
              <span class="ellipsis">…</span>
            } @else {
              <button class="page-btn" [class.active]="p === currentPage()" (click)="currentPage.set(p)">
                {{ p }}
              </button>
            }
          }
        </div>

        <div class="goto">
          <span class="filter-label">Go to</span>
          <input #gotoInput type="number" min="1" [max]="totalPages()" placeholder="—"
            (keydown.enter)="goToPage(gotoInput.value); gotoInput.value = ''"
          />
          <button (click)="goToPage(gotoInput.value); gotoInput.value = ''">▶</button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }

    .hist-header {
      padding: 12px 20px 10px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: baseline;
      gap: 16px;
    }
    .hist-eyebrow { color: var(--green); font-size: 9px; letter-spacing: 0.2em; font-weight: 700; margin: 0; }
    .hist-header small { color: var(--muted); font-size: 10px; }

    .filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--line);
      flex-wrap: nowrap;
      overflow-x: auto;
    }

    .filter-bar select,
    .filter-bar input[type="datetime-local"] {
      background: var(--panel);
      border: 1px solid var(--line);
      color: var(--fg);
      border-radius: 4px;
      font-size: 11px;
      height: 26px;
      padding: 0 6px;
    }
    .filter-bar select { width: 110px; }
    .filter-bar select:nth-child(2) { width: 96px; }
    .filter-bar input[type="datetime-local"] { width: 176px; }

    .filter-label {
      font-size: 10px;
      color: var(--muted);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .clear-btn {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--muted);
      border-radius: 4px;
      font-size: 11px;
      height: 26px;
      padding: 0 10px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .clear-btn:hover { border-color: var(--fg); color: var(--fg); }

    .result-count {
      margin-left: auto;
      font-size: 10px;
      color: var(--muted);
      white-space: nowrap;
      flex-shrink: 0;
      padding-left: 8px;
    }

    .table-wrap { overflow-x: auto; }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      table-layout: fixed;
    }

    .col-ts   { width: 160px; }
    .col-src  { width: 90px; }
    .col-sev  { width: 82px; }
    .col-code { width: 200px; }
    .col-msg  { width: auto; }

    thead tr { background: var(--panel); }
    th {
      padding: 7px 12px;
      text-align: left;
      font-size: 9px;
      letter-spacing: 0.1em;
      color: var(--muted);
      font-weight: 600;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
    }

    td {
      padding: 7px 12px;
      border-bottom: 1px solid var(--line);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    tr:nth-child(even) td { background: rgba(255,255,255,0.015); }

    td.ts { font-family: "IBM Plex Mono", monospace; font-size: 10px; color: var(--muted); }
    td.src { color: var(--muted); }
    td.code { font-family: "IBM Plex Mono", monospace; font-size: 10px; }
    td.msg { color: var(--muted); }

    td.empty { text-align: center; color: var(--muted); padding: 24px; }

    .badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.06em;
      padding: 2px 7px;
      border-radius: 3px;
      background: rgba(255,255,255,0.05);
      color: var(--muted);
    }
    .badge.info    { background: rgba(0,140,112,0.1);  color: var(--green); }
    .badge.warning { background: rgba(199,124,0,0.12); color: var(--amber); }
    .badge.error   { background: rgba(213,62,62,0.1);  color: var(--red); }

    .pagination {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-top: 1px solid var(--line);
      flex-wrap: nowrap;
      overflow-x: auto;
    }

    .page-info {
      font-size: 10px;
      color: var(--muted);
      white-space: nowrap;
      flex-shrink: 0;
      margin-right: 6px;
    }

    .page-btns { display: flex; align-items: center; gap: 4px; }

    .page-btn {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--muted);
      border-radius: 3px;
      font-size: 11px;
      height: 24px;
      min-width: 28px;
      padding: 0 6px;
      cursor: pointer;
    }
    .page-btn:hover { border-color: var(--fg); color: var(--fg); }
    .page-btn.active { background: var(--green); border-color: var(--green); color: #000; font-weight: 700; }

    .ellipsis { font-size: 12px; color: var(--muted); padding: 0 2px; }

    .goto {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-left: auto;
      flex-shrink: 0;
    }
    .goto input {
      width: 44px;
      background: var(--panel);
      border: 1px solid var(--line);
      color: var(--fg);
      border-radius: 4px;
      font-size: 11px;
      height: 24px;
      padding: 0 5px;
      text-align: center;
    }
    .goto button {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--muted);
      border-radius: 3px;
      font-size: 11px;
      height: 24px;
      padding: 0 8px;
      cursor: pointer;
    }
    .goto button:hover { border-color: var(--fg); color: var(--fg); }
  `],
})
export class History implements OnInit {
  readonly events = input<CellEvent[]>([]);

  private readonly destroyRef = inject(DestroyRef);
  private readonly serverBuffer = signal<CellEvent[]>([]);

  readonly filterRobot = signal('');
  readonly filterType = signal('');
  readonly filterFrom = signal('');
  readonly filterTo = signal('');
  readonly currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  readonly allEvents = computed(() => {
    const byId = new Map<string, CellEvent>();
    for (const e of this.serverBuffer()) byId.set(e.id, e);
    for (const e of this.events()) byId.set(e.id, e);
    return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
  });

  readonly filteredEvents = computed(() => {
    const robot = this.filterRobot();
    const type = this.filterType();
    const from = this.filterFrom() ? new Date(this.filterFrom()).getTime() : null;
    const to = this.filterTo() ? new Date(this.filterTo()).getTime() : null;
    return this.allEvents().filter((e) => {
      if (robot && e.source !== robot) return false;
      if (type && e.severity !== type) return false;
      if (from !== null && e.timestamp < from) return false;
      if (to !== null && e.timestamp > to) return false;
      return true;
    });
  });

  readonly pagedEvents = computed(() => {
    const page = this.currentPage();
    return this.filteredEvents().slice((page - 1) * this.PAGE_SIZE, page * this.PAGE_SIZE);
  });

  readonly totalPages = computed(() => Math.ceil(this.filteredEvents().length / this.PAGE_SIZE));

  readonly pageStart = computed(() => (this.currentPage() - 1) * this.PAGE_SIZE + 1);
  readonly pageEnd = computed(() =>
    Math.min(this.currentPage() * this.PAGE_SIZE, this.filteredEvents().length),
  );

  readonly visiblePages = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: number[] = [1];
    if (current > 3) pages.push(-1);
    for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
    if (current < total - 2) pages.push(-1);
    pages.push(total);
    return pages;
  });

  constructor() {
    effect(() => {
      this.filterRobot(); this.filterType(); this.filterFrom(); this.filterTo();
      this.currentPage.set(1);
    });
  }

  ngOnInit(): void {
    this.fetchEvents();
    const timer = window.setInterval(() => this.fetchEvents(), 10_000);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  clearFilters(): void {
    this.filterRobot.set('');
    this.filterType.set('');
    this.filterFrom.set('');
    this.filterTo.set('');
  }

  goToPage(value: string): void {
    const page = Math.max(1, Math.min(this.totalPages(), Number(value)));
    if (!isNaN(page)) this.currentPage.set(page);
  }

  private fetchEvents(): void {
    fetch('/api/events')
      .then((r) => r.json() as Promise<EventsResponse>)
      .then((data) => this.serverBuffer.set(data.events))
      .catch(() => {});
  }
}
