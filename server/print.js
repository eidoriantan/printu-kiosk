
const fs = require('node:fs').promises
const path = require('node:path')
const crypto = require('node:crypto')
const util = require('node:util')
const exec = util.promisify(require('node:child_process').exec)
const express = require('express')
const multer = require('multer')
const pdfjam = require('pdfjam')
const sendMail = require('./utils/send-mail')
const asyncWrap = require('./utils/async-wrap')

const router = express.Router()
const upload = multer()
const uploadPrint = upload.fields([
  {
    name: 'pdf',
    maxCount: 1
  }
])

async function isPrinting () {
  const { stdout } = await exec('lpstat -o', { windowsHide: true })
  return stdout !== ''
}

const lowPaper = typeof process.env.LOW_PAPER !== 'undefined' ? parseInt(process.env.LOW_PAPER) : 10
let papers = typeof process.env.INITIAL_PAPERS !== 'undefined' ? parseInt(process.env.INITIAL_PAPERS) : 50
let mailed = ''
async function checkInks () {
  const { stdout } = await exec('ink -p usb')
  const lines = stdout.split('\n')
  const noInks = []
  let hasInk = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const matches = line.match(/^([a-zA-Z]+):\s+([0-9]+)%$/)
    if (matches !== null) {
      const ink = matches[1]
      const percentage = parseInt(matches[2])

      if (percentage > 10) hasInk = true
      else noInks.push(ink)
    }
  }

  const noInksStr = noInks.join(', ')
  if (!hasInk || (noInks.length > 0 && noInksStr !== mailed)) {
    const options = {
      host: process.env.SMTP_SERVER,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    }

    mailed = noInksStr
    sendMail(
      process.env.NOTIFY_FROM,
      process.env.ADMIN_EMAIL,
      'PRINTU KIOSK NOTIFY',
      noInks.length > 0 ? `${noInksStr} ink(s) is below 10%!` : 'Printer has no ink',
      options
    )
  }

  return hasInk
}

router.get('/', asyncWrap(async (req, res) => {
  res.json({
    success: true,
    printing: await isPrinting()
  })
}))

router.delete('/', asyncWrap(async (req, res) => {
  await exec('cancel -a', { windowsHide: true })
  res.json({ success: true })
}))

router.post('/', uploadPrint, asyncWrap(async (req, res) => {
  const printing = await isPrinting()
  if (printing) {
    return res.json({
      success: false,
      message: 'Server is busy printing...'
    })
  }

  if (process.env.CHECK_INKS) {
    const hasInks = await checkInks()
    if (!hasInks) {
      return res.json({
        success: false,
        message: 'Printer has no inks. Please try again later'
      })
    }
  }

  const buffer = req.files.pdf[0].buffer
  const total = parseInt(req.body.total)
  const totalPages = parseInt(req.body.total_pages)
  const page = parseInt(req.body.page)
  const npps = parseInt(req.body.npps)
  const color = req.body.color
  const copies = parseInt(req.body.copies)

  if (papers < total) {
    return res.json({
      success: false,
      message: 'Not enough papers'
    })
  }

  let filename = ''
  let pdfpath = ''
  while (pdfpath === '') {
    const random = Buffer.from(crypto.randomBytes(4)).toString('hex')
    const filepath = path.resolve(__dirname, `../tmp/${random}.pdf`)
    try {
      await fs.access(filepath, fs.constants.F_OK)
    } catch (error) {
      filename = random
      pdfpath = filepath
    }
  }

  await fs.writeFile(pdfpath, buffer)

  if (color === 'BW') {
    const newpath = path.resolve(__dirname, `../tmp/${filename}-grayscaled.pdf`)
    await exec(`gs -sDEVICE=pdfwrite -sProcessColorModel=DeviceGray -sColorConversionStrategy=Gray -dOverrideICC -o "${newpath}" -f "${pdfpath}"`)
    await fs.unlink(pdfpath)
    pdfpath = newpath
  }

  const nupPath = path.resolve(__dirname, `../tmp/${filename}-nup.pdf`)
  const nupOptions = {
    papersize: '{21.6cm,27.9cm}',
    outfile: nupPath
  }

  if (npps === 2) {
    await pdfjam.nup(pdfpath, 1, 2, nupOptions)
  } else if (npps === 4) {
    await pdfjam.nup(pdfpath, 2, 2, nupOptions)
  } else if (npps === 6) {
    nupOptions.orientation = 'landscape'
    await pdfjam.nup(pdfpath, 3, 2, nupOptions)
  } else if (npps === 9) {
    await pdfjam.nup(pdfpath, 3, 3, nupOptions)
  }

  if (npps > 1) {
    await fs.unlink(pdfpath)
    pdfpath = nupPath
  }

  let totalPagesC = totalPages
  let spaces = 0
  while (totalPagesC > 0) {
    totalPagesC = Math.floor(totalPagesC / 10)
    spaces++
  }

  let pageStr = page.toString()
  while (pageStr.length < spaces) pageStr = `0${pageStr}`

  const pdfroot = path.resolve(__dirname, `../tmp/${filename}`)
  await exec(`pdftoppm -jpeg -f ${page} -l ${page} "${pdfpath}" "${pdfroot}"`, { windowsHide: true })
  const previewPath = `${pdfroot}-${pageStr}.jpg`
  const previewBuffer = await fs.readFile(previewPath, { encoding: 'base64' })
  const previewUri = `data:image/jpeg;base64,${previewBuffer}`
  await fs.unlink(previewPath)

  await exec(`lp -s -P ${page} -n ${copies} -o media=Letter "${pdfpath}"`, { windowsHide: true })
  await fs.unlink(pdfpath)
  papers -= copies

  if (papers <= lowPaper) {
    const options = {
      host: process.env.SMTP_SERVER,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    }

    sendMail(
      process.env.NOTIFY_FROM,
      process.env.ADMIN_EMAIL,
      'PRINTU KIOSK NOTIFY',
      'No papers',
      options
    )
  }

  res.json({
    success: true,
    hash: crypto.createHash('md5').update(buffer).digest('hex'),
    preview: previewUri
  })
}))

module.exports = router
