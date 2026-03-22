#!/usr/bin/env python3
"""Check port usage for 5173, 8002, 2567 on Windows"""

import subprocess
import re
import sys
import os

def get_port_info(port):
    """Get process info for a given port using netstat"""
    try:
        # Run netstat with -ano flags (all connections, no names, owning process)
        output = subprocess.check_output(f'netstat -ano | findstr ":{port}"', 
                                       shell=True, text=True, stderr=subprocess.DEVNULL)
        
        if not output.strip():
            return None
        
        # Parse netstat output
        for line in output.strip().split('\n'):
            if 'LISTENING' in line:
                # Line format: Proto  Local Address  Foreign Address  State  PID
                parts = line.split()
                if len(parts) >= 5:
                    pid = parts[-1]
                    return {'pid': pid, 'listening': True}
        
        return None
    except subprocess.CalledProcessError:
        return None

def get_process_info(pid):
    """Get process details from PID using tasklist and wmic"""
    try:
        pid = str(pid)
        
        # Get process name from tasklist
        tasklist_output = subprocess.check_output(f'tasklist /FI "PID eq {pid}" /V /NH', 
                                                  shell=True, text=True, stderr=subprocess.DEVNULL)
        
        # Get detailed info from wmic
        try:
            wmic_output = subprocess.check_output(
                f'wmic process where processid={pid} get commandline,executablepath /value',
                shell=True, text=True, stderr=subprocess.DEVNULL)
        except:
            wmic_output = ""
        
        return {
            'tasklist': tasklist_output.strip(),
            'wmic': wmic_output.strip()
        }
    except Exception as e:
        return {'error': str(e)}

def main():
    ports = [5173, 8002, 2567]
    twistedkart_keywords = ['node', 'vite', 'frontend', 'backend', 'realtime', 'npm', 'py']
    
    print("=" * 80)
    print("PORT USAGE CHECK FOR TWISTEDKART")
    print("=" * 80)
    print()
    
    for port in ports:
        print(f"{'=' * 40}")
        print(f"PORT {port}")
        print(f"{'=' * 40}")
        
        port_info = get_port_info(port)
        
        if port_info and port_info.get('listening'):
            pid = port_info['pid']
            print(f"Status: LISTENING")
            print(f"PID: {pid}")
            print()
            
            proc_info = get_process_info(pid)
            
            if 'tasklist' in proc_info:
                print("Process Info (tasklist):")
                print(proc_info['tasklist'])
                print()
            
            if 'wmic' in proc_info:
                print("Process Details (wmic):")
                print(proc_info['wmic'])
                print()
                
                # Check if it's a TwistedKart process
                info_text = (proc_info['wmic'] + proc_info['tasklist']).lower()
                is_twistedkart = any(keyword in info_text for keyword in twistedkart_keywords)
                
                if is_twistedkart:
                    print("TwistedKart Related: LIKELY YES (contains relevant keywords)")
                else:
                    print("TwistedKart Related: LIKELY NO")
            
            if 'error' in proc_info:
                print(f"Error getting process info: {proc_info['error']}")
        else:
            print(f"Status: NOT LISTENING")
        
        print()

if __name__ == '__main__':
    main()
