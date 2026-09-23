import { jsPDF } from 'jspdf';

import type {
  MeetingContext,
  MeetingState,
} from './meeting-capture-model';

const COLORS = {
  navy: [11, 32, 57] as const,
  navyLight: [18, 51, 82] as const,
  ink: [25, 39, 57] as const,
  muted: [91, 108, 124] as const,
  line: [214, 222, 230] as const,
  paper: [247, 249, 251] as const,
  orange: [232, 164, 92] as const,
  white: [255, 255, 255] as const,
  green: [36, 125, 94] as const,
};

const PAGE_WIDTH = 215.9;
const PAGE_HEIGHT = 279.4;
const MARGIN = 17;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function formatDate(value: string) {
  if (!value) return 'Date to be confirmed';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
}

function formatTime(value: string) {
  if (!value) return 'Time to be confirmed';
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function toFilename(value: string) {
  const safeTitle = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `pixl-sports-${safeTitle || 'meeting'}-recap.pdf`;
}

function drawText(
  pdf: jsPDF,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight = 5,
) {
  const lines = pdf.splitTextToSize(text || 'Not recorded', width) as string[];
  pdf.text(lines, x, y, { baseline: 'top' });
  return y + lines.length * lineHeight;
}

function drawSectionHeading(pdf: jsPDF, label: string, x: number, y: number) {
  pdf.setFillColor(...COLORS.orange);
  pdf.circle(x + 1.5, y + 2.5, 1.5, 'F');
  pdf.setTextColor(...COLORS.navy);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text(label.toUpperCase(), x + 7, y, { baseline: 'top' });
}

function drawFooter(pdf: jsPDF, pageNumber: number) {
  pdf.setDrawColor(...COLORS.line);
  pdf.setLineWidth(0.25);
  pdf.line(MARGIN, PAGE_HEIGHT - 14, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 14);
  pdf.setTextColor(...COLORS.muted);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text('PIXL SPORTS  /  MEETING RECAP', MARGIN, PAGE_HEIGHT - 8);
  pdf.text(`PAGE ${pageNumber}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 8, { align: 'right' });
}

function ensureSpace(pdf: jsPDF, y: number, needed: number, pageNumber: { value: number }) {
  if (y + needed <= PAGE_HEIGHT - 21) return y;
  drawFooter(pdf, pageNumber.value);
  pdf.addPage();
  pageNumber.value += 1;
  pdf.setFillColor(...COLORS.paper);
  pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
  return MARGIN;
}

function drawCard(pdf: jsPDF, x: number, y: number, width: number, height: number) {
  pdf.setFillColor(...COLORS.white);
  pdf.setDrawColor(...COLORS.line);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(x, y, width, height, 2, 2, 'FD');
}

function drawBulletList(
  pdf: jsPDF,
  items: string[],
  x: number,
  y: number,
  width: number,
  options: { checks?: boolean; muted?: boolean } = {},
) {
  let nextY = y;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(...(options.muted ? COLORS.muted : COLORS.ink));

  for (const item of items.length ? items : ['Not recorded']) {
    const marker = options.checks
      ? item.startsWith('[x]') ? 'CHECKED' : 'OPEN';
      : '-';
    const label = options.checks ? item.replace(/^\[[x ]\]\s*/, '') : item;
    const lines = pdf.splitTextToSize(label, width - (options.checks ? 13 : 7)) as string[];
    const lineHeight = 4.8;
    const rowHeight = Math.max(7, lines.length * lineHeight + 2);
    nextY = ensureSpace(pdf, nextY, rowHeight, pageNumber);

    if (options.checks) {
      pdf.setDrawColor(...(marker === 'CHECKED' ? COLORS.green : COLORS.line));
      pdf.setLineWidth(0.5);
      pdf.roundedRect(x, nextY + 1, 4, 4, 0.7, 0.7, marker === 'CHECKED' ? 'FD' : 'S');
      if (marker === 'CHECKED') {
        pdf.setTextColor(...COLORS.white);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6);
        pdf.text('x', x + 1.15, nextY + 1.1, { baseline: 'top' });
      }
      pdf.setTextColor(...(options.muted ? COLORS.muted : COLORS.ink));
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9.5);
      pdf.text(lines, x + 9, nextY + 0.5, { baseline: 'top' });
    } else {
      pdf.setTextColor(...COLORS.orange);
      pdf.setFont('helvetica', 'bold');
      pdf.text('-', x, nextY + 0.5, { baseline: 'top' });
      pdf.setTextColor(...(options.muted ? COLORS.muted : COLORS.ink));
      pdf.setFont('helvetica', 'normal');
      pdf.text(lines, x + 6, nextY + 0.5, { baseline: 'top' });
    }
    nextY += rowHeight;
  }
  return nextY;
}

let pageNumber = { value: 1 };

export function buildMeetingRecapPdf(context: MeetingContext, state: MeetingState) {
  const pdf = new jsPDF({ unit: 'mm', format: 'letter' });
  pageNumber = { value: 1 };
  pdf.setProperties({
    title: `Pixl Sports meeting recap: ${context.title}`,
    subject: 'Meeting recap',
    author: 'Pixl Sports',
    creator: 'Pixl Sports',
  });

  pdf.setFillColor(...COLORS.paper);
  pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
  pdf.setFillColor(...COLORS.navy);
  pdf.rect(0, 0, PAGE_WIDTH, 57, 'F');
  pdf.setFillColor(...COLORS.orange);
  pdf.rect(0, 0, 7, 57, 'F');

  pdf.setTextColor(...COLORS.orange);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('PIXL SPORTS', MARGIN, 15);
  pdf.setTextColor(...COLORS.white);
  pdf.setFontSize(7.5);
  pdf.text('TEAM OPERATIONS  /  MEETING RECAP', MARGIN, 23);
  pdf.setFontSize(25);
  pdf.text(context.title.toUpperCase(), MARGIN, 35, { baseline: 'top' });
  pdf.setTextColor(196, 214, 228);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.text(
    `${formatDate(context.date)}  ·  ${formatTime(context.time)}  ·  ${context.location || 'Location to be confirmed'}`,
    MARGIN,
    48,
  );

  let y = 68;
  const cardGap = 5;
  const cardWidth = (CONTENT_WIDTH - cardGap) / 2;
  const present = state.participants.filter((participant) => participant.present);
  const absent = state.participants.filter((participant) => !participant.present);

  drawCard(pdf, MARGIN, y, cardWidth, 28);
  drawCard(pdf, MARGIN + cardWidth + cardGap, y, cardWidth, 28);
  drawSectionHeading(pdf, 'Attendance', MARGIN + 7, y + 6);
  drawSectionHeading(pdf, 'Meeting status', MARGIN + cardWidth + cardGap + 7, y + 6);
  pdf.setTextColor(...COLORS.ink);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text(`${present.length} present`, MARGIN + 7, y + 14);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...COLORS.muted);
  pdf.text(`${absent.length} absent  ·  ${state.agenda.filter((item) => item.completed).length}/${state.agenda.length} agenda complete`, MARGIN + 7, y + 21);
  pdf.setTextColor(...COLORS.green);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text('COMPLETED', MARGIN + cardWidth + cardGap + 7, y + 15);
  pdf.setTextColor(...COLORS.muted);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.text('Ready to share', MARGIN + cardWidth + cardGap + 7, y + 22);
  y += 38;

  const agenda = state.agenda.filter((item) => item.label.trim()).map((item) => `${item.completed ? '[x]' : '[ ]'} ${item.label}`);
  const attendanceNames = [
    present.length ? `Present: ${present.map((participant) => participant.name).join(', ')}` : 'Present: None recorded',
    absent.length ? `Absent: ${absent.map((participant) => participant.name).join(', ')}` : 'Absent: None recorded',
  ];
  const agendaHeight = Math.max(33, agenda.length * 8 + 23);
  const attendanceHeight = Math.max(33, 23 + attendanceNames.map((line) => pdf.splitTextToSize(line, cardWidth - 14).length * 5).reduce((sum, count) => sum + count, 0));
  const twoColumnHeight = Math.max(agendaHeight, attendanceHeight);
  y = ensureSpace(pdf, y, twoColumnHeight, pageNumber);
  drawCard(pdf, MARGIN, y, cardWidth, twoColumnHeight);
  drawCard(pdf, MARGIN + cardWidth + cardGap, y, cardWidth, twoColumnHeight);
  drawSectionHeading(pdf, 'Agenda', MARGIN + 7, y + 6);
  drawSectionHeading(pdf, 'Who was in the room', MARGIN + cardWidth + cardGap + 7, y + 6);
  drawBulletList(pdf, agenda, MARGIN + 7, y + 14, cardWidth - 14, { checks: true });
  drawBulletList(pdf, attendanceNames, MARGIN + cardWidth + cardGap + 7, y + 14, cardWidth - 14, { muted: true });
  y += twoColumnHeight + 9;

  const notes = state.notes.trim() || 'No live notes recorded.';
  const noteLines = pdf.splitTextToSize(notes, CONTENT_WIDTH - 14) as string[];
  const notesHeight = Math.max(36, 22 + noteLines.length * 4.8);
  y = ensureSpace(pdf, y, notesHeight, pageNumber);
  drawCard(pdf, MARGIN, y, CONTENT_WIDTH, notesHeight);
  drawSectionHeading(pdf, 'Notes from the room', MARGIN + 7, y + 6);
  pdf.setTextColor(...COLORS.ink);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(noteLines, MARGIN + 7, y + 15, { baseline: 'top' });
  y += notesHeight + 9;

  const decisions = state.decisions.filter((decision) => decision.text.trim()).map((decision) => decision.text.trim());
  const followUps = state.followUps
    .filter((followUp) => followUp.task.trim())
    .map((followUp) => `${followUp.task.trim()}${followUp.owner ? `  /  Owner: ${followUp.owner}` : ''}${followUp.dueDate ? `  /  Due: ${followUp.dueDate}` : ''}`);
  const decisionsHeight = Math.max(35, 23 + Math.max(1, decisions.length) * 7);
  const followUpsHeight = Math.max(35, 23 + Math.max(1, followUps.length) * 7);
  const bottomHeight = Math.max(decisionsHeight, followUpsHeight);
  y = ensureSpace(pdf, y, bottomHeight, pageNumber);
  drawCard(pdf, MARGIN, y, cardWidth, bottomHeight);
  drawCard(pdf, MARGIN + cardWidth + cardGap, y, cardWidth, bottomHeight);
  drawSectionHeading(pdf, 'Decisions', MARGIN + 7, y + 6);
  drawSectionHeading(pdf, 'Follow-ups', MARGIN + cardWidth + cardGap + 7, y + 6);
  drawBulletList(pdf, decisions, MARGIN + 7, y + 14, cardWidth - 14);
  drawBulletList(pdf, followUps, MARGIN + cardWidth + cardGap + 7, y + 14, cardWidth - 14);
  drawFooter(pdf, pageNumber.value);

  return pdf;
}

export function downloadMeetingRecapPdf(context: MeetingContext, state: MeetingState) {
  buildMeetingRecapPdf(context, state).save(toFilename(context.title));
}