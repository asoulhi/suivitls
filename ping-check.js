// ping-check.js
const net = require('net');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const PORTS_TO_TRY = [80, 443, 22, 8080, 8081, 23, 53];
const TIMEOUT_MS = 3000;

function checkPort(ip, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', (err) => finish(err.code === 'ECONNREFUSED'));
    socket.connect(port, ip);
  });
}

async function isHostReachable(ip) {
  const results = await Promise.all(PORTS_TO_TRY.map((p) => checkPort(ip, p)));
  return results.some((r) => r === true);
}

async function main() {
  console.log('--- SuiviTLS ping-check (TCP) : démarrage ---');
  const docRef = db.collection('suiviTLS').doc('stores');
  const doc = await docRef.get();
  if (!doc.exists) {
    console.log('Aucun document "stores" trouvé dans Firestore. Arrêt.');
    return;
  }
  const stores = doc.data().data || [];
  const withIp = stores.filter((s) => s.ip && s.ip.trim());
  console.log(`${stores.length} magasin(s) au total, ${withIp.length} avec une IP publique.`);
  let changed = 0;
  const BATCH_SIZE = 10;
  for (let i = 0; i < withIp.length; i += BATCH_SIZE) {
    const batch = withIp.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (store) => {
        const reachable = await isHostReachable(store.ip);
        const wasConnected = !!store.connecte;
        if (reachable !== wasConnected) {
          store.connecte = reachable;
          store.statut = reachable ? '✔ Connecté' : 'Déconnecté';
          changed++;
          console.log(`  ${reachable ? '✔' : '✕'} ${store.nom} (${store.ip}) -> ${store.statut}`);
        }
      })
    );
  }
  if (changed > 0) {
    await docRef.set({ data: stores });
    console.log(`--- Terminé : ${changed} magasin(s) mis à jour dans Firestore ---`);
  } else {
    console.log('--- Terminé : aucun changement de statut ---');
  }
}

main().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
