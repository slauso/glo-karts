#!/usr/bin/env python3
"""
Check port usage for ports 5173, 8002, 2567 on Windows using psutil
"""

import sys
import subprocess

# Try importing psutil
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False
    print("psutil not available, will use fallback methods")

def check_with_psutil():
    """Check ports using psutil"""
    if not HAS_PSUTIL:
        return None
    
    ports_info = {}
    ports = [5173, 8002, 2567]
    
    try:
        for conn in psutil.net_connections():
            if conn.laddr.port in ports and conn.status == 'LISTEN':
                pid = conn.pid
                try:
                    proc = psutil.Process(pid)
                    ports_info[conn.laddr.port] = {
                        'pid': pid,
                        'name': proc.name(),
                        'exe': proc.exe(),
                        'cmdline': ' '.join(proc.cmdline()),
                        'cwd': proc.cwd(),
                        'status': 'LISTENING'
                    }
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    ports_info[conn.laddr.port] = {
                        'pid': pid,
                        'status': 'LISTENING (access denied)'
                    }
    except Exception as e:
        print(f"Error with psutil: {e}")
        return None
    
    return ports_info if ports_info else None

def check_with_netstat():
    """Check ports using netstat fallback"""
    ports_info = {}
    ports = [5173, 8002, 2567]
    
    try:
        netstat_output = subprocess.check_output('netstat -ano', shell=True, text=True)
    except Exception as e:
        print(f"Error running netstat: {e}")
        return None
    
    for line in netstat_output.split('\n'):
        for port in ports:
            port_str = f':{port}'
            if port_str in line and 'LISTENING' in line:
                parts = line.split()
                if len(parts) >= 5:
                    pid_str = parts[-1]
                    try:
                        pid = int(pid_str)
                        # Get process name
                        try:
                            tasklist_output = subprocess.check_output(
                                f'tasklist /FI "PID eq {pid}" /NH', 
                                shell=True, text=True, stderr=subprocess.DEVNULL)
                            proc_name = tasklist_output.split()[0] if tasklist_output.split() else 'Unknown'
                        except:
                            proc_name = 'Unknown'
                        
                        # Get command line
                        try:
                            wmic_output = subprocess.check_output(
                                f'wmic process where processid={pid} get commandline,workingdirectory /value',
                                shell=True, text=True, stderr=subprocess.DEVNULL)
                        except:
                            wmic_output = ''
                        
                        ports_info[port] = {
                            'pid': pid,
                            'name': proc_name,
                            'line': line.strip(),
                            'wmic': wmic_output,
                            'status': 'LISTENING'
                        }
                    except ValueError:
                        pass
    
    return ports_info if ports_info else None

def main():
    ports = [5173, 8002, 2567]
    port_descriptions = {
        5173: 'Vite Frontend (expected if frontend dev server running)',
        8002: 'Django Backend (expected if backend running)',
        2567: 'Colyseus Realtime Server (expected if realtime service running)'
    }
    
    print("=" * 80)
    print("PORT USAGE CHECK FOR TWISTEDKART")
    print("=" * 80)
    print()
    
    # Try psutil first
    ports_info = check_with_psutil()
    
    # Fallback to netstat if psutil not available or failed
    if ports_info is None:
        print("Using netstat fallback method...")
        print()
        ports_info = check_with_netstat()
    
    # Display results
    for port in ports:
        print(f"PORT {port} - {port_descriptions[port]}")
        print("-" * 80)
        
        if ports_info and port in ports_info:
            info = ports_info[port]
            print(f"Status: {info.get('status', 'LISTENING')}")
            print(f"PID: {info.get('pid', 'Unknown')}")
            
            if 'name' in info:
                print(f"Process Name: {info['name']}")
            
            if 'exe' in info:
                print(f"Executable: {info['exe']}")
            
            if 'cmdline' in info:
                print(f"Command Line: {info['cmdline']}")
            
            if 'cwd' in info:
                print(f"Working Directory: {info['cwd']}")
            
            if 'line' in info:
                print(f"Netstat Entry: {info['line']}")
            
            if 'wmic' in info and info['wmic']:
                print(f"WMIC Details: {info['wmic']}")
            
            # Check if TwistedKart related
            full_info = str(info).lower()
            tk_keywords = ['node', 'npm', 'vite', 'python', 'django', 'colyseus', 
                          'realtime', 'backend', 'frontend']
            is_tk = any(kw in full_info for kw in tk_keywords)
            
            print(f"TwistedKart Related: {'YES' if is_tk else 'POSSIBLY'}")
        else:
            print("Status: NOT LISTENING")
            print("TwistedKart Related: NO")
        
        print()

if __name__ == '__main__':
    main()
