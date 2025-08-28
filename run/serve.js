
import { spawn } from 'node:child_process';

const command = process.platform === 'win32' 
    ? `.\\run\\_serve.bat` 
    : './run/_serve.sh';

const child = spawn(command, {
    shell: true,
    stdio: 'inherit'
});

child.on('close', (code) => {
    console.log(`\nProcess finished with code ${code}`);
});

child.on('error', (error) => {
    console.error(`Error: ${error}`);
});
