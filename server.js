 // Proxy simplu care pornește backend-ul din subfolder
import { spawn } from 'child_process';

const backend = spawn('node', ['backend/dist/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT || 3001 }
});

backend.on('error', (error) => {
  console.error('Backend error:', error);
  process.exit(1);
});

backend.on('close', (code) => {
  console.log(`Backend exited with code ${code}`);
  process.exit(code);
});