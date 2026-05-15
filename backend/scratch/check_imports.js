import fs from 'fs';
import path from 'path';

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else if (file.endsWith('.ts')) {
            results.push(file);
        }
    });
    return results;
}

const files = walk('src');
files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('ApiError') && !content.includes('import { ApiError }') && !content.includes('export class ApiError')) {
        console.log(`Missing import in ${file}`);
    }
});
