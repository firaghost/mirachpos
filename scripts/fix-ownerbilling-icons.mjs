import fs from 'node:fs';

const file = 'd:/Projects/mirachpos/screens/owner/OwnerBilling.tsx';

const original = fs.readFileSync(file, 'utf8');
const hasCrLf = original.includes('\r\n');
const text = original.replace(/\r\n/g, '\n');

const beforeRefresh = `                <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing} className="h-9 px-3 gap-2 text-muted-foreground hover:text-foreground">
                    <span className={cn("material-symbols-outlined text-[18px]", refreshing && "animate-spin")}>sync</span>
                    Refresh
                </Button>`;

const afterRefresh = `                <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing} className="h-9 px-3 gap-2 text-muted-foreground hover:text-foreground">
                    <AppIcon name="sync" className={cn("text-[18px]", refreshing && "animate-spin")} size={18} />
                    Refresh
                </Button>`;

const beforeStatus = `                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <span className={cn("material-symbols-outlined text-6xl", isActive ? "text-emerald-500" : "text-amber-500")}>
                            {isActive ? 'check_circle' : 'warning'}
                        </span>
                    </div>`;

const afterStatus = `                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <AppIcon
                            name={isActive ? 'check_circle' : 'warning'}
                            className={cn("text-6xl", isActive ? "text-emerald-500" : "text-amber-500")}
                            size={60}
                        />
                    </div>`;

let next = text;
next = next.replace(beforeRefresh, afterRefresh);
next = next.replace(beforeStatus, afterStatus);

if (next === text) {
  console.error('No changes applied. Check OwnerBilling.tsx content.');
  process.exit(1);
}

const output = hasCrLf ? next.replace(/\n/g, '\r\n') : next;
fs.writeFileSync(file, output, 'utf8');
console.log('OwnerBilling icons updated.');
