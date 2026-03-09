import sys

f = r'c:\Users\laptop\twistedkart\DEVELOPMENT_TASK_LIST.txt'
try:
    with open(f, 'r', encoding='utf-8') as fh:
        c = fh.read()
    
    c = c.replace('[DONE]', '\U0001F7E2 [DONE]')
    c = c.replace('[IN PROGRESS]', '\U0001F7E1 [IN PROGRESS]')
    c = c.replace('[TODO]', '\U0001F534 [TODO]')
    c = c.replace('[BLOCKED]', '\U0001F7E0 [BLOCKED]')
    c = c.replace('[CUT]', '\u26AB [CUT]')
    c = c.replace('[SKIP]', '\U0001F535 [SKIP]')
    
    with open(f, 'w', encoding='utf-8') as fh:
        fh.write(c)
    
    print('COLORIZE COMPLETE')
    print(f'DONE: {c.count(chr(0x1F7E2))}')
    print(f'TODO: {c.count(chr(0x1F534))}')
    print(f'IN PROGRESS: {c.count(chr(0x1F7E1))}')
    print(f'BLOCKED: {c.count(chr(0x1F7E0))}')
    print(f'CUT: {c.count(chr(0x26AB))}')
    print(f'SKIP: {c.count(chr(0x1F535))}')
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
