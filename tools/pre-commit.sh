#!/bin/sh
# מספר גרסה (Akordi X.N) וגרסת ה-service worker לפי תוכן הקבצים השמורים.
# main: כל עדכון שמתפרסם מקבל מספר עוקב. dev (beta): המספר של הגרסה הבאה + מספר בנייה, למשל 0.74b3
cd "$(git rev-parse --show-toplevel)" || exit 0
read MAJ BASE < .version
BR=$(git rev-parse --abbrev-ref HEAD)
if [ "$BR" = "dev" ]; then
  N=$(( $(git rev-list --count main) + 1 - BASE ))
  B=$(( $(git rev-list --count main..HEAD) + 1 ))
  VER="$MAJ.${N}b$B"
else
  N=$(( $(git rev-list --count HEAD 2>/dev/null || echo 0) + 1 - BASE ))
  VER="$MAJ.$N"
fi
sed -i "s/^const APPV='[^']*';/const APPV='$VER';/" index.html
sed -i "s/^const VER='[^']*';/const VER='$VER';/" sw.js
H=$( (grep -v "^const V=" sw.js; cat index.html fonts/OpenSans500-he.woff icon.svg manifest.webmanifest icons/*.png privacy.html terms.html legal.css) | sha1sum | cut -c1-10)
sed -i "s/^const V='[^']*';/const V='$H';/" sw.js
git add index.html sw.js
