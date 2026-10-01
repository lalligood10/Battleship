import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { commentaryForGame } from '../game/commentary';
import { sendChatMessage } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { listenChatMessages } from '../lib/firestore';
import {
  isSpeechEnabled,
  setSpeechEnabled,
  setSpeechVolume,
  speakCommentary,
  speechVolume,
} from '../lib/sound';
import { isBotGame, opponentUid, type ChatMessage, type Game } from '../lib/types';
import { Reactions } from './Reactions';

const OPEN_KEY = 'broadside.chat.open';
const MAX_MESSAGE_LENGTH = 240;

export function GameChat({ game, uid }: { game: Game; uid: string }) {
  const botGame = isBotGame(game);
  const opponent = opponentUid(game, uid);
  const opponentName = (opponent && game.players[opponent]?.username) || 'Opponent';
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === 'true');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [speech, setSpeech] = useState(isSpeechEnabled);
  const [volume, setVolume] = useState(speechVolume);
  const listRef = useRef<HTMLDivElement>(null);
  const initialChat = useRef(true);
  const seenMessageIds = useRef(new Set<string>());

  const commentary = useMemo(() => commentaryForGame(game, uid), [game, uid]);
  const spokenCount = useRef(commentary.length);

  useEffect(() => {
    if (botGame) return;
    return listenChatMessages(
      game.id,
      (next) => {
        if (!initialChat.current && !open) {
          const incoming = next.filter((message) => message.uid !== uid && !seenMessageIds.current.has(message.id)).length;
          if (incoming) setUnread((count) => count + incoming);
        }
        seenMessageIds.current = new Set(next.map((message) => message.id));
        initialChat.current = false;
        setMessages(next);
      },
      (err) => setError(errorMessage(err)),
    );
  }, [game.id, uid, botGame, open]);

  useEffect(() => {
    const next = commentary.slice(spokenCount.current);
    spokenCount.current = commentary.length;
    if (next.length) speakCommentary(next.map((line) => line.text).join(' '));
  }, [commentary]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, [open, messages.length, commentary.length]);

  const toggleOpen = () => {
    const next = !open;
    localStorage.setItem(OPEN_KEY, String(next));
    if (next) setUnread(0);
    setOpen(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendChatMessage(game.id, text);
      setDraft('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleSpeech = () => {
    const next = !speech;
    setSpeechEnabled(next);
    setSpeech(next);
    if (next) speakCommentary(`Computer commentary enabled at ${Math.round(volume * 100)} percent volume.`);
  };

  const changeVolume = (next: number) => {
    setSpeechVolume(next);
    setVolume(next);
  };

  return (
    <>
      <button
        type="button"
        className={`game-chat-toggle${open ? ' game-chat-toggle--open' : ''}`}
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="game-chat-panel"
      >
        {botGame ? 'Commentary' : 'Chat'}
        {!open && unread > 0 && <span className="game-chat-unread">{unread}</span>}
      </button>

      <aside
        id="game-chat-panel"
        className={`game-chat${open ? ' game-chat--open' : ''}`}
        aria-label={botGame ? 'Computer commentary' : `Chat with ${opponentName}`}
        aria-hidden={!open}
        inert={!open}
      >
        <header className="game-chat__header">
          <div>
            <strong>{botGame ? 'Computer commentary' : opponentName}</strong>
            <span>{botGame ? 'Scripted play-by-play' : 'In-game chat'}</span>
          </div>
          <button type="button" className="btn btn--ghost btn--icon" onClick={toggleOpen} aria-label="Close chat">
            ×
          </button>
        </header>

        <div ref={listRef} className="game-chat__messages" aria-live="polite">
          {botGame ? (
            commentary.length ? (
              commentary.map((line) => (
                <div key={line.id} className="game-chat__message game-chat__message--opponent">
                  <strong>{opponentName}</strong>
                  <p>{line.text}</p>
                </div>
              ))
            ) : (
              <p className="small muted">Commentary will appear after the first shot.</p>
            )
          ) : messages.length ? (
            messages.map((message) => (
              <div
                key={message.id}
                className={`game-chat__message${message.uid === uid ? ' game-chat__message--mine' : ' game-chat__message--opponent'}`}
              >
                <strong>{message.uid === uid ? 'You' : message.username}</strong>
                <p>{message.text}</p>
              </div>
            ))
          ) : (
            <p className="small muted">No messages yet. Keep it friendly.</p>
          )}
        </div>

        {error && (
          <p className="game-chat__error small" role="alert">
            {error}
          </p>
        )}

        {botGame ? (
          <div className="game-chat__controls">
            <label className="row row--between">
              <span>Read commentary aloud</span>
              <input type="checkbox" checked={speech} onChange={toggleSpeech} />
            </label>
            <label>
              <span className="row row--between">
                <span>Voice volume</span>
                <span>{Math.round(volume * 100)}%</span>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                disabled={!speech}
                onChange={(event) => changeVolume(Number(event.target.value))}
                aria-label="Commentary voice volume"
              />
            </label>
          </div>
        ) : (
          <div className="game-chat__composer">
            <Reactions game={game} uid={uid} />
            <form onSubmit={(event) => void submit(event)}>
              <input
                value={draft}
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={`Message ${opponentName}`}
                aria-label={`Message ${opponentName}`}
              />
              <button className="btn btn--primary" type="submit" disabled={!draft.trim() || busy}>
                Send
              </button>
            </form>
            <span className="small muted">{draft.length}/{MAX_MESSAGE_LENGTH}</span>
          </div>
        )}
      </aside>
    </>
  );
}
