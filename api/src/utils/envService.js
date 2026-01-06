const fs = require('fs');
const path = require('path');
const os = require('os');

// Path to .env file (assuming api root has .env)
const ENV_PATH = path.resolve(__dirname, '../../.env');

/**
 * Update or set an environment variable in the .env file and process.env
 * @param {string} key 
 * @param {string} value 
 */
const updateEnv = (key, value) => {
    // Update current process env
    process.env[key] = value;

    let content = '';
    try {
        if (fs.existsSync(ENV_PATH)) {
            content = fs.readFileSync(ENV_PATH, 'utf8');
        }
    } catch (e) {
        console.warn('Failed to read .env file', e);
    }

    const lines = content.split(/\r?\n/);
    let found = false;

    // Quote value if it spans multiple lines or contains special characters
    const safeValue = (typeof value === 'string' && (value.includes('\n') || value.includes('\r') || value.includes(' ') || value.includes('"')))
        ? `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
        : value;

    // Simple regex to match KEY=... lines (handles basic cases)
    const newLines = lines.map(line => {
        if (!line.trim() || line.startsWith('#')) return line;

        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const currentKey = match[1].trim();
            if (currentKey === key) {
                found = true;
                return `${key}=${safeValue}`;
            }
        }
        return line;
    });

    if (!found) {
        // Ensure valid EOL before appending
        if (newLines.length > 0 && newLines[newLines.length - 1] !== '') {
            newLines.push('');
        }
        newLines.push(`${key}=${safeValue}`);
    }

    try {
        fs.writeFileSync(ENV_PATH, newLines.join(os.EOL));
    } catch (e) {
        console.error('Failed to write .env file', e);
        throw new Error('Failed to save configuration to environment file');
    }
};

module.exports = { updateEnv };
