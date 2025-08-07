require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');
const nodemailer = require('nodemailer');

require('dotenv').config();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

let transporter;
let usingEthereal = false;

async function initMailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: (SMTP_SECURE === 'true'),
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      },
      tls: {
        rejectUnauthorized: process.env.SMTP_TLS_REJECT !== 'false'
      },
      connectionTimeout: Number(process.env.SMTP_CONN_TIMEOUT || 10_000)
    });
    console.log('Configured transporter using SMTP_HOST:', SMTP_HOST);
  } else {
    console.log('SMTP env vars missing — creating Ethereal test account for development.');
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass }
    });
    usingEthereal = true;
    console.log('Ethereal account created. Preview messages at runtime (nodemailer.getTestMessageUrl).');
  }

  try {
    await transporter.verify();
    console.log('SMTP transporter verified and ready.');
  } catch (err) {
    console.error('Error verifying SMTP transporter:', err && err.message ? err.message : err);
  }
}

function buildEmailContent(donorName, neederName, neederPhone, bloodGroup, location) {
  const subject = `Request for blood donation (${bloodGroup}) — ${neederName}`;
  const text = `Hello ${donorName},

A person near ${location} requires blood type ${bloodGroup}.

Name: ${neederName}
Phone: ${neederPhone}

Please contact them directly if you can help.

— Blood Donor Finder
`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#222;">
    <p>Hello <strong>${donorName}</strong>,</p>
    <p><strong>A person needs blood type ${bloodGroup} in/near ${location}.</strong></p>
    <p>
      <strong>Name:</strong> ${neederName}<br/>
      <strong>Phone:</strong> ${neederPhone}
    </p>
    <p>Please contact them directly if you can help. Thank you.</p>
    <p style="font-size:0.9em;color:#666">Blood Donor Finder</p>
  </div>
  `;
  return { subject, text, html };
}

app.get('/register', (req, res) => res.render('register'));

app.post('/register', (req, res) => {
  const { name, email, phone, blood_group, location } = req.body;
  const sql = 'INSERT INTO donors (name, email, phone, blood_group, location) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [name, email, phone, blood_group, location], (err) => {
    if (err) {
      console.error('DB insert error:', err);
      return res.status(500).send('DB error');
    }
    res.redirect('/find');
  });
});

app.get('/find', (req, res) => {
  const { blood_group, location } = req.query;
  if (blood_group && location) {
    const sql = 'SELECT * FROM donors WHERE blood_group = ? AND location LIKE ?';
    db.query(sql, [blood_group, `%${location}%`], (err, results) => {
      if (err) {
        console.error('DB query error:', err);
        return res.status(500).send('DB error');
      }
      res.render('find', { donors: results, reqQuery: req.query });
    });
  } else {
    res.render('find', { donors: null, reqQuery: req.query });
  }
});

app.post('/request', async (req, res) => {
  try {
    const { donor_id, needer_name, needer_phone } = req.body;
    if (!donor_id || !needer_name || !needer_phone) {
      return res.redirect('/find?sent=0&error=missing_parameters');
    }

    const sql = 'SELECT * FROM donors WHERE id = ? LIMIT 1';
    db.query(sql, [donor_id], async (err, results) => {
      if (err) {
        console.error('DB error fetching donor:', err);
        return res.redirect('/find?sent=0&error=db_error');
      }
      if (!results.length) {
        return res.redirect('/find?sent=0&error=donor_not_found');
      }

      const donor = results[0];
      const { subject, text, html } = buildEmailContent(donor.name, needer_name, needer_phone, donor.blood_group || 'N/A', donor.location || 'N/A');

      const mailOptions = {
        from: `"${process.env.FROM_NAME || 'Blood Donor Finder'}" <${process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com'}>`,
        to: donor.email,
        subject,
        text,
        html,
        replyTo: process.env.REPLY_TO || process.env.FROM_EMAIL || process.env.SMTP_USER
      };

      try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Mail sent:', info.messageId || info);
        if (usingEthereal) {
          console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
        }
        return res.redirect('/find?sent=1');
      } catch (mailErr) {
        console.error('Error sending mail:', mailErr && mailErr.message ? mailErr.message : mailErr);
        return res.redirect('/find?sent=0&error=' + encodeURIComponent(mailErr.message || 'mail_error'));
      }
    });
  } catch (outerErr) {
    console.error('Unexpected error in /request:', outerErr);
    return res.redirect('/find?sent=0&error=unexpected');
  }
});

app.get('/', (req, res) => res.redirect('/register'));

(async () => {
  await initMailer();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
})();
