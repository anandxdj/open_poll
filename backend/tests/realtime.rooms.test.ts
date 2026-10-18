import { describe, expect, it } from 'bun:test';
import type { Socket } from 'socket.io';
import {
  MAX_JOINS_PER_MINUTE,
  allowJoin,
  audienceParticipantId,
  leavePresentationRooms,
  legacyRoomForAudience,
  liveRoomForAudience,
} from '../src/common/realtime/rooms';

const PID = '64b7f0c2a1b2c3d4e5f60718';
const OTHER_PID = '64b7f0c2a1b2c3d4e5f60719';
const PARTICIPANT_ID = '64b7f0c2a1b2c3d4e5f6071a';

describe('audience rooms', () => {
  it('maps every audience to its live room', () => {
    expect(liveRoomForAudience(PID, 'all')).toBe(`live:${PID}`);
    expect(liveRoomForAudience(PID, 'host')).toBe(`live:${PID}:host`);
    expect(liveRoomForAudience(PID, `participant:${PARTICIPANT_ID}`)).toBe(`live:${PID}:p:${PARTICIPANT_ID}`);
    expect(liveRoomForAudience(PID, 'participant:')).toBeNull();
    expect(liveRoomForAudience(PID, 'participant:abc')).toBeNull();
  });

  it('maps only all/host to the legacy rooms', () => {
    expect(legacyRoomForAudience(PID, 'all')).toBe(`quiz_${PID}`);
    expect(legacyRoomForAudience(PID, 'host')).toBe(`quiz_${PID}_host`);
    expect(legacyRoomForAudience(PID, `participant:${PARTICIPANT_ID}`)).toBeNull();
  });

  it('parses participant audiences', () => {
    expect(audienceParticipantId(`participant:${PARTICIPANT_ID}`)).toBe(PARTICIPANT_ID);
    expect(audienceParticipantId('host')).toBeNull();
    expect(audienceParticipantId(`participant:${PARTICIPANT_ID}:host`)).toBeNull();
  });
});

describe('leavePresentationRooms', () => {
  it("leaves one presentation's legacy and live rooms and nothing else", () => {
    const rooms = new Set([
      'socket-id',
      `quiz_${PID}`,
      `quiz_${PID}_host`,
      `live:${PID}`,
      `live:${PID}:host`,
      `live:${PID}:p:${PARTICIPANT_ID}`,
      `quiz_${OTHER_PID}`,
      `live:${OTHER_PID}`,
      `poll_${PID}`,
    ]);
    const socket = { rooms, leave: (room: string) => rooms.delete(room) } as unknown as Socket;

    leavePresentationRooms(socket, PID);

    expect([...rooms].sort()).toEqual(['socket-id', `live:${OTHER_PID}`, `poll_${PID}`, `quiz_${OTHER_PID}`].sort());
  });
});

describe('allowJoin', () => {
  it('caps joins per connection per minute', () => {
    const socket = {} as Socket;
    const start = 1_000_000;
    for (let i = 0; i < MAX_JOINS_PER_MINUTE; i++) expect(allowJoin(socket, start + i)).toBe(true);
    expect(allowJoin(socket, start + 59_000)).toBe(false);
    expect(allowJoin(socket, start + 60_001)).toBe(true);
  });

  it('keeps a separate budget per socket', () => {
    const a = {} as Socket;
    const b = {} as Socket;
    for (let i = 0; i < MAX_JOINS_PER_MINUTE; i++) allowJoin(a, 0);
    expect(allowJoin(a, 0)).toBe(false);
    expect(allowJoin(b, 0)).toBe(true);
  });
});
