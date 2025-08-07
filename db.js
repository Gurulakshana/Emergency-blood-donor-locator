const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '12345678',
  database: 'blood_donor_db'
});

connection.connect((err) => {
  if (err) throw err;
  console.log('MySQL Connected...');
});

module.exports = connection;



