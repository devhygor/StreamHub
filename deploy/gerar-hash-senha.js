// Uso: SENHA='sua senha' node deploy/gerar-hash-senha.js  -> imprime a linha STREAMHUB_PASS_HASH=...
const { hashPassword } = require('../server/login');
if (!process.env.SENHA) { console.error("Defina SENHA='...'"); process.exit(1); }
console.log('STREAMHUB_PASS_HASH=' + hashPassword(process.env.SENHA));
