"""Opt-in real-host smoke. Requires pyte in an isolated Python environment, never installs it.
The only loaded extension presents synthetic selections; no Intercom runtime/role/board is loaded.
All input is local deterministic UI test input, never a model or production consent source.
"""
import errno, fcntl, json, os, pty, re, select, signal, struct, sys, termios, time
import pyte

fixture, cli, node, mode = sys.argv[1:]
questions = json.load(open(os.path.join(fixture, 'questions.json')))
end_time = time.monotonic() + 85
columns, rows = 40, 16
screen = pyte.Screen(columns, rows)
stream = pyte.Stream(screen)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(fixture)
    env = {'PATH': os.environ.get('PATH', ''), 'HOME': fixture, 'TERM': 'xterm-256color',
           'LANG': 'C.UTF-8', 'PI_CODING_AGENT_DIR': os.path.join(fixture, 'agent'),
           'PI_OFFLINE': '1', 'PI_TELEMETRY': '0'}
    os.execve(node, [node, cli, '--offline', '--no-session', '--no-extensions', '--no-mcp',
                    '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files',
                    '--no-tools', '--no-approve', '--tui-mode', mode, '-e', os.path.join(fixture, 'smoke.mjs')], env)

def resize(c, r):
    global columns, rows
    columns, rows = c, r
    screen.resize(r, c)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
    os.kill(pid, signal.SIGWINCH)

def pump(wait=0.04):
    if time.monotonic() > end_time:
        raise AssertionError('overall smoke deadline expired')
    if select.select([fd], [], [], wait)[0]:
        try:
            data = os.read(fd, 262144)
        except OSError as exc:
            if exc.errno == errno.EIO:
                raise AssertionError('disposable host exited before proof')
            raise
        stream.feed(data.decode('utf-8', errors='replace'))

def wait_for(predicate, label, seconds=6):
    deadline = min(end_time, time.monotonic() + seconds)
    while time.monotonic() < deadline:
        pump()
        value = predicate()
        if value:
            return value
    raise AssertionError(label + '\n' + '\n'.join(screen.display))

def send(value):
    os.write(fd, value.encode())

def viewport():
    for at, line in enumerate(screen.display):
        found = re.match(r'\s*Context (\d+)-(\d+)/(\d+)', line)
        if found:
            return at, *map(int, found.groups())
    return None

def answers():
    try:
        return [json.loads(line) for line in open(os.path.join(fixture, 'answers.jsonl'))]
    except FileNotFoundError:
        return []

def normalized(value):
    return re.sub(r'\s', '', value)

def exercise(index, c, r, action='no'):
    before = len(answers())
    resize(c, r)
    send('/smoke %d\r' % index)
    wait_for(viewport, 'visible context did not open')
    painted = {}
    pages = 0
    while True:
        at, first, last, total = viewport()
        visible = [line[1:-1] for line in screen.display]  # overlay margin excludes underlying host border cells
        assert any('→ No' in line for line in visible), 'No not preselected'
        assert any(line.strip() == 'Yes' for line in visible), 'Yes choice missing\n' + '\n'.join(visible)
        # Context occupies the contiguous viewport immediately above its range indicator.
        count = last - first + 1
        for offset, line in enumerate(visible[at-count:at]):
            painted[first+offset] = line
        pages += 1
        if last == total:
            break
        send('\x1b[6~')
        wait_for(lambda: viewport() and viewport()[1] != first, 'PgDn did not expose next context')
    expected = 'Intercom coordinator adoption · ' + questions[index]['kind'] + '\n\n' + questions[index]['prompt']
    recovered = ''.join(painted[i] for i in sorted(painted))
    assert normalized(recovered) == normalized(expected), 'complete visible context mismatch branch %d at %dx%d' % (index, c, r)
    send('\x1b[H')
    wait_for(lambda: viewport() and viewport()[1] == 1, 'Home did not retrieve first page')
    assert any('Intercom coordinator' in line for line in screen.display), 'first page not durable'
    if action == 'paste':
        send('\x1b[200~\x1b[B\rYes\x1b[201~')
        for _ in range(5): pump()
        assert len(answers()) == before, 'paste submitted a decision'
        assert any('→ No' in line for line in screen.display), 'paste changed selection'
        send('\x1b')
    elif action == 'yes':
        send('\x1b[B')
        wait_for(lambda: any('→ Yes' in line for line in screen.display), 'arrow did not select Yes')
        assert len(answers()) == before, 'navigation submitted without activation'
        send('\r')
    elif action == 'esc': send('\x1b')
    else: send('\r')
    outcome = wait_for(lambda: len(answers()) > before and answers()[-1], 'answer was not captured')
    assert outcome == {'index': index, 'answer': action == 'yes'}, 'wrong capture: ' + str(outcome)
    wait_for(lambda: viewport() is None, 'overlay did not dismiss')
    print('PASS branch=%d %s %dx%d pages=%d answer=%s full-context=exact' %
          (index, questions[index]['kind'], c, r, pages, action), flush=True)

try:
    resize(columns, rows)
    # Wait for an idle editor; no prompt/model input is ever submitted.
    wait_for(lambda: any('Thinking' in line or 'tokens' in line or 'No model' in line or '─' in line for line in screen.display), 'idle Pi did not start', 12)
    for _ in range(5): pump()
    for index in range(8): exercise(index, 40, 16)
    exercise(7, 100, 30, 'yes')
    exercise(7, 60, 18, 'esc')
    exercise(7, 40, 12, 'paste')
    assert not os.path.exists(os.path.join(fixture, '.pi-intercom')), 'unexpected board effects'
    assert not os.path.exists(os.path.join(fixture, 'coordinator-claim.md')), 'unexpected claim effects'
    print('PASS real Pi PTY + pyte terminal emulator; native SelectList; no text entry; No default/Enter, explicit Yes, Esc, paste; no board/claim/model/auth/role effects.', flush=True)
finally:
    # Only the disposable, child-owned test host is terminated. Never touches a registered worker.
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if os.waitpid(pid, os.WNOHANG)[0]: break
        time.sleep(0.02)
    else:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    os.close(fd)
