require('dotenv').config();
const express = require('express');
const app = express();
const imgSteam = require('image-steam');
const multer = require('multer');
const passport = require('passport');
const Strategy = require('passport-http-bearer').Strategy;
const db = require('./db');
const fs  = require('fs');
const md5 = require('md5');
const mime = require('mime-types');
const filetype = require('magic-bytes.js');

const allowedImageTypes = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml'
];

const allowedImageExtensions = [
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg'
];

const upload = multer({
  dest: 'temp_images/',
  onError: function (err, next) {
    next(err);
  },
  fileFilter: function (req, file, cb) {
    if (allowedImageTypes.indexOf(file.mimetype) === -1) {
      req.fileValidationError = 'goes wrong on the mimetype';
      return cb(null, false, new Error('goes wrong on the mimetype'));
    }
    
    const ext = file.originalname.substring(file.originalname.lastIndexOf('.'));
    if (allowedImageExtensions.indexOf(ext) === -1) {
      req.fileValidationError = 'goes wrong on the extension';
      return cb(null, false, new Error('goes wrong on the extension'));
    }

    cb(null, true);
  }
});

const storage = multer.diskStorage({
  filename: function (req, file, cb) {
    const ext = file.originalname.substring(file.originalname.lastIndexOf('.'));
    const originalname = file.originalname.substring(0, file.originalname.lastIndexOf('.'))
    const filename = originalname + '-' + md5(Date.now() + '-' + file.originalname).substring(0, 5) + ext;
    cb(null, filename)
  },
  destination: function (req, file, cb) {
    cb(null, 'temp_files/')
  },
                                   });

const allowedFileTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const allowedFileExtensions = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx'
];

const uploadFile = multer({
  storage: storage,
  dest: 'temp_files/',
  onError: function (err, next) {
    next(err);
  },
  fileFilter: function (req, file, cb) {
    if (allowedFileTypes.indexOf(file.mimetype) === -1) {
      req.fileValidationError = 'goes wrong on the mimetype';
      return cb(null, false, new Error('goes wrong on the mimetype'));
    }
    
    const ext = file.originalname.substring(file.originalname.lastIndexOf('.'));
    if (allowedFileExtensions.indexOf(ext) === -1) {
      req.fileValidationError = 'goes wrong on the extension';
      return cb(null, false, new Error('goes wrong on the extension'));
    }

    cb(null, true);
  },
  limits: {
    // 15 mb limit
    fileSize: 15*1024*1024
  }
});

const imageSteamConfig = {
  "storage": {
    "defaults": {
      "driver": "fs",
      "path": "./images",
    },
    "cacheTTS": process.env.CACHE_TTS || 86400 * 14, /* 24 * 14 hrs */
    "cacheOptimizedTTS": process.env.CACHE_OPTIMIZED_TTS || 86400 * 14, /*  24 * 14 hrs */
    "cacheArtifacts": process.env.CACHE_ARTIFACTS || true
  },
  "throttle": {
    "ccProcessors": process.env.THROTTLE_CC_PROCESSORS || 4,
    "ccPrefetchers": process.env.THROTTLE_CC_PREFETCHER || 20,
    "ccRequests": process.env.THROTTLE_CC_REQUESTS || 100
  },
  log: {
    errors: false
  }
};

const argv = require('yargs')
  .usage('Usage: $0 [options] pathToImage')
  .demand(0)
  .options({
    'port': {
      alias: 'p',
      describe: 'Port number the service will listen to',
      type: 'number',
      group: 'Image service',
      default: process.env.PORT_API || 9999
    },
    'portImageSteam': {
      alias: 'pis',
      describe: 'Port number the Image server will listen to',
      type: 'number',
      group: 'Image service',
      default: process.env.PORT_IMAGE_SERVER || 13337
    },
  })
  .help()
  .argv;

passport.use(new Strategy(
  function (token, done) {
    db.clients.findByToken(token, function (err, client) {
      if (err) {
        return done(err);
      }
      if (!client) {
        return done(null, false);
      }
      return done(null, client, {scope: 'all'});
    });
  }
));

/**
 * Instantiate the Image steam server, and proxy it with
 */
const ImageServer = new imgSteam.http.Connect(imageSteamConfig);
const imageHandler = ImageServer.getHandler();

/**
 * Most errors is not found
 * @TODO: requires debugging if other errors are handled by server
 */
ImageServer.on('error', (err) => {
  // Don't log 404 errors, so we do nothing here.
});

app.get('/image/*',
  function (req, res, next) {
    req.url = req.url.replace('/image', '');

    /**
     * Pass request en response to the imageserver
     */
    imageHandler(req, res);
  });


app.get('/files/*',
  function (req, res, next) {

    const filePath = decodeURI(req.url.replace(/^\/+/, ''));;
    
    // Check if file specified by the filePath exists
    fs.exists(filePath, function(exists){
      if (exists) {
        // Content-type is very interesting part that guarantee that
        // Web browser will handle response in an appropriate manner.
        
        // Get filename
        const filename = filePath.substring(filePath.lastIndexOf('/') + 1);
        const mimeType = mime.lookup(filename);
        
        res.writeHead(200, {
          "Content-Type": mimeType,
          "Content-Disposition": "attachment; filename=" + filename
        });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(400, {"Content-Type": "text/plain"});
        res.end("ERROR File does not exist");
      }
    });



  });

/**
 *  The url for creating one Image
 */
app.post('/image',
  passport.authenticate('bearer', {session: false}),
  upload.single('image'), (req, res, next) => {
    const tempFile = 'temp_images/' + req.file.filename;
    const newFile = 'images/' + req.file.filename;
  
    // Check if the image has a valid type by checking the magic bytes
    const mime = filetype.filetypemime(fs.readFileSync(tempFile));
    
    console.log (tempFile, mime, 'mime of temp file');
    
    let valid = false;
    mime.forEach(mimetype => {
      if (allowedImageTypes.includes(mimetype)) {
        valid = true;
      }
    })
    
    if (!res.headerSent) {
      res.setHeader('Content-Type', 'application/json');
    }
    
    if (!valid) {
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        console.error ('unlink error', e);
        res.status(400).send(JSON.stringify({error: 'Incorrect mimetype'}));
        return;
      }
      
      console.error ('incorrect mimetype');
      res.status(400).send(JSON.stringify({error: 'Incorrect mimetype'}));
      return;
    }
    
    try {
      fs.renameSync(tempFile, newFile);
    } catch (e) {
      res.status(500).send(JSON.stringify({error: 'Error during upload'}));
      return;
    }
    
    res.send(JSON.stringify({
      url: process.env.APP_URL + '/image/' + req.file.filename
    }));
  });

/*app.post('/images',
  passport.authenticate('bearer', {session: false}),
  upload.array('images', 30), (req, res, next) => {
    // req.files is array of `photos` files
    // req.body will contain the text fields, if there were any
    if (!res.headerSent) {
      res.setHeader('Content-Type', 'application/json');
    }

    res.send(JSON.stringify(req.files.map((file) => {
      return {
        url: process.env.APP_URL + '/image/' + req.file.filename
      }
    })));
  });*/

app.post('/file',
  //passport.authenticate('bearer', {session: false}),
  uploadFile.single('file'), (req, res, next) => {
    
    const tempFile = 'temp_files/' + req.file.filename;
    const newFile = 'files/' + req.file.filename;
  
    // Check if the image has a valid type by checking the magic bytes
    const mime = filetype.filetypemime(fs.readFileSync(tempFile));
    
    console.log (tempFile, mime, 'mime of temp file');
    
    let valid = false;
    mime.forEach(mimetype => {
      if (allowedFileTypes.includes(mimetype)) {
        valid = true;
      }
    })
    
    if (!res.headerSent) {
      res.setHeader('Content-Type', 'application/json');
    }
    
    if (!valid) {
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        console.error ('unlink error', e);
        res.status(400).send(JSON.stringify({error: 'Incorrect mimetype'}));
        return;
      }
      
      console.error ('incorrect mimetype');
      res.status(400).send(JSON.stringify({error: 'Incorrect mimetype'}));
      return;
    }
    
    try {
      fs.renameSync(tempFile, newFile);
    } catch (e) {
      res.status(500).send(JSON.stringify({error: 'Error during upload'}));
      return;
    }
    
    console.log(req.file);
    res.send(JSON.stringify({
      url: process.env.APP_URL + '/' + newFile
    }));
  });

app.use(function (err, req, res, next) {
  const status = err.status ? err.status : 500;
  //console.log('err', err);
  if (!res.headerSent) {
    res.setHeader('Content-Type', 'application/json');
  }
  res.status(status).send(JSON.stringify({
    error: err.message
  }));
})

app.listen(argv.port, function () {
  console.log('Application listen on port %d...', argv.port);
  //console.log('Image  server listening on port %d...', argv.portImageSteam);
});
