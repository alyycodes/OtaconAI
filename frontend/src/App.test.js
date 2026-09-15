import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

/* Build a fake server-sent-events body the app can read. */
function sseResponse(frames) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: () =>
          i < frames.length
            ? Promise.resolve({ done: false, value: encoder.encode(frames[i++]) })
            : Promise.resolve({ done: true, value: undefined }),
      }),
    },
  };
}

function mockServer({ stream, health = { ok: true, json: async () => ({ status: 'ok' }) } } = {}) {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/health')) return Promise.resolve(health);
    return Promise.resolve(
      stream ||
        sseResponse([
          'data: {"delta":"Reply from "}\n\n',
          'data: {"delta":"the server."}\n\n',
          'data: {"done":true}\n\n',
        ])
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  mockServer();
});

afterEach(() => {
  jest.resetAllMocks();
});

test('opens on the empty state with a composer ready', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /codec open/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/^message$/i)).toBeInTheDocument();
});

test('send stays disabled until something is typed', () => {
  render(<App />);
  const send = screen.getByLabelText(/send message/i);
  expect(send).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/^message$/i), { target: { value: 'Hello' } });
  expect(send).toBeEnabled();
});

test('streams a reply and assembles the chunks', async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText(/^message$/i), { target: { value: 'Ping' } });
  fireEvent.click(screen.getByLabelText(/send message/i));

  expect(await screen.findByText('Ping')).toBeInTheDocument();
  expect(await screen.findByText(/reply from the server\./i)).toBeInTheDocument();
});

test('surfaces the server error detail', async () => {
  mockServer({
    stream: { ok: false, status: 502, json: async () => ({ detail: 'Gemini request failed' }) },
  });
  render(<App />);

  fireEvent.change(screen.getByLabelText(/^message$/i), { target: { value: 'Ping' } });
  fireEvent.click(screen.getByLabelText(/send message/i));

  expect(await screen.findByText(/gemini request failed/i)).toBeInTheDocument();
});

test('explains what to do when the backend is unreachable', async () => {
  global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  render(<App />);

  fireEvent.change(screen.getByLabelText(/^message$/i), { target: { value: 'Ping' } });
  fireEvent.click(screen.getByLabelText(/send message/i));

  expect(await screen.findByText(/can't reach the backend/i)).toBeInTheDocument();
});

test('filters conversations with the search box', async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText(/search conversations/i), {
    target: { value: 'zzz no match' },
  });

  await waitFor(() => {
    expect(screen.getByText(/no conversations match/i)).toBeInTheDocument();
  });
});

test('creates a new conversation', async () => {
  render(<App />);
  fireEvent.click(screen.getAllByRole('button', { name: /new conversation/i })[0]);

  await waitFor(() => {
    expect(screen.getByText('2 saved')).toBeInTheDocument();
  });
});
