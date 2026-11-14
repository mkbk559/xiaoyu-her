#!/data/data/com.termux/files/usr/bin/bash
while true; do
  sshpass -p '<SET_PASSWORD>' ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -p 20742 -N -R 15555:127.0.0.1:5555 root@<SERVER_IP>
  sleep 8
done
