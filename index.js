
const fs = require('node:fs')
const path = require('node:path')
const { exec } = require('node:child_process')
const express = require('express')
const dotenv = require('dotenv')

let configPath = path.resolve(__dirname, '.env.local')
if (!fs.existsSync(configPath)) configPath = path.resolve(__dirname, '.env')
dotenv.config({ path: configPath })

const printAPI = require('./server/print')
const status = require('./server/status')

if (process.platform !== 'linux') {
  console.error('This program only supports Linux')
  process.exit(1)
}

exec('lpstat -d', { windowsHide: true }, (error, stdout, stderr) => {
  if (error) {
    console.error(stderr)
    process.exit(1)
  }

  if (stdout === 'no system default destination') {
    console.error(stdout)
    process.exit(1)
  }

  status.start()
  console.log(stdout)
})

const tmpDir = path.resolve(__dirname, 'tmp')
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir)

const app = express()
const port = process.env.PORT || '3001'
const publicPath = path.resolve(__dirname, 'build')

app.use('/', express.static(publicPath))
app.use('/api/print', printAPI)

app.use((req, res, next) => {
  const indexPath = path.resolve(publicPath, 'index.html')
  res.sendFile(indexPath)
})

app.use((err, req, res, next) => {
  res.status(500).json({
    success: false,
    message: err
  })
})

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`)
})
