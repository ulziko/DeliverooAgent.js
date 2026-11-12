import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// absolute path, so that this script can be launched from any directory
const agentPath = fileURLToPath( new URL( './intention_revision.js', import.meta.url ) );

// Function to spawn child processes
function spawnProcesses() {
    for ( let i = 0; i < 5; i++ ) {
        const name = 'm_'+i;

        // no token, so each agent connects with a new identity named NAME
        const childProcess = spawn( process.execPath, [ agentPath ], {
            env: { ...process.env, TOKEN: '', NAME: name }
        } );

        childProcess.stdout.on('data', data => {
            console.log(`Output from ${name}: ${data}`);
        });

        childProcess.stderr.on('data', data => {
            console.error(`Error from ${name}: ${data}`);
        });

        childProcess.on('close', code => {
            console.log(`Child process ${name} exited with code ${code}`);
        });
    }
}

// Start the processes
spawnProcesses();
