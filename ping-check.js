// ping-check.js
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

let firstErrorLogged = false;

async function pingHost(ip) {
  try {
    await execAsync(`sudo ping -c 2 -W 3 ${ip}`);
    return true;
  } catch (e) {
    if (!firstErrorLogged) {
      firstErrorLogged = true;
      console.log('--- DIAGNOSTIC (première erreur de ping) ---');
      console.log('stdout:', e.stdout);
      console.log('stderr:', e.stderr);
      console.log('code:', e.code);
      console.log('--- fin diagnostic ---');
    }
    return false;
  }
}

async function main() {
  console.log('--- SuiviTLS ping-check : démarrage ---');
  const docRef = db.collection('suiviTLS').doc('stores');
  const doc = await docRef.get();
  if (!doc.exists) {
    console.log('Aucun document "stores" trouvé.');
    return;
  }
  const stores = doc.data().data || [];
  const withIp = stores.filter((s) => s.ip && s.ip.trim());
  console.log(`${stores.length} magasin(s), ${withIp.length} avec IP.`);
  let changed = 0;
  const BATCH_SIZE = 10;
  for (let i = 0; i < withIp.length; i += BATCH_SIZE) {
    const batch = withIp.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (store) => {
        const reachable = await pingHost(store.ip);
        const wasConnected = !!store.connecte;
        if (reachable !== wasConnected) {
          store.connecte = reachable;
          store.statut = reachable ? '✔ Connecté' : 'Déconnecté';
          changed++;
        }
        console.log(`  ${reachable ? '✔' : '✕'} ${store.nom} (${store.ip})`);
      })
    );
  }
  if (changed > 0) {
    await docRef.set({ data: stores });
    console.log(`--- ${changed} magasin(s) mis à jour ---`);
  } else {
    console.log('--- Aucun changement ---');
  }
}

main().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
