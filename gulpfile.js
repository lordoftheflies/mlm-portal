/*
@license
Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

'use strict';

// Include promise polyfill for node 0.10 compatibility
require('es6-promise').polyfill();

// Include Gulp & tools we'll use
var gulp = require('gulp');
var $ = require('gulp-load-plugins')();
var del = require('del');
var runSequence = require('run-sequence');
var browserSync = require('browser-sync');
var reload = browserSync.reload;
var merge = require('merge-stream');
var path = require('path');
var fs = require('fs');
var glob = require('glob-all');
var historyApiFallback = require('connect-history-api-fallback');
var packageJson = require('./package.json');
var crypto = require('crypto');
var ensureFiles = require('./tasks/ensure-files.js');
var JSONstringify = require('json-stringify-safe');
var through = require('through2');
var stripBom = require('strip-bom');
var xliff2bundlejson = require('xliff2bundlejson');
// var ghPages = require('gulp-gh-pages');

var AUTOPREFIXER_BROWSERS = [
  'ie >= 10',
  'ie_mob >= 10',
  'ff >= 30',
  'chrome >= 34',
  'safari >= 7',
  'opera >= 23',
  'ios >= 7',
  'android >= 4.4',
  'bb >= 10'
];

// Build options
var config = {
  dev: !!$.util.env.dev, // --dev for development build
  locales: $.util.env.targets ? $.util.env.targets.split(/ /) : [] // list of target locales
};

// Localizable attributes repository for gulp-i18n-preprocess
var attributesRepository = {};
// Locale bundles for gulp-i18n-leverage
var bundles = {};

var DIST = 'dist';

var dist = function(subpath) {
  return !subpath ? DIST : path.join(DIST, subpath);
};

var styleTask = function(stylesPath, srcs) {
  return gulp.src(srcs.map(function(src) {
      return path.join('app', stylesPath, src);
    }))
    .pipe($.changed(stylesPath, {extension: '.css'}))
    .pipe($.autoprefixer(AUTOPREFIXER_BROWSERS))
    .pipe(gulp.dest('.tmp/' + stylesPath))
    .pipe($.minifyCss())
    .pipe(gulp.dest(dist(stylesPath)))
    .pipe($.size({title: stylesPath}));
};

var imageOptimizeTask = function(src, dest) {
  return gulp.src(src)
    .pipe($.imagemin({
      progressive: true,
      interlaced: true
    }))
    .pipe(gulp.dest(dest))
    .pipe($.size({title: 'images'}));
};

var optimizeHtmlTask = function(src, dest) {
  var assets = $.useref.assets({
    searchPath: ['.tmp', 'app']
  });

  return gulp.src(src)
    .pipe(assets)
    // Concatenate and minify JavaScript
    .pipe($.if('*.js', $.uglify({
      preserveComments: 'some'
    })))
    // Concatenate and minify styles
    // In case you are still using useref build blocks
    .pipe($.if('*.css', $.minifyCss()))
    .pipe(assets.restore())
    .pipe($.useref())
    // Minify any HTML
    .pipe($.if('*.html', $.minifyHtml({
      quotes: true,
      empty: true,
      spare: true
    })))
    // Output files
    .pipe(gulp.dest(dest))
    .pipe($.size({
      title: 'html'
    }));
};

// Scan HTMLs and construct localizable attributes repository.
gulp.task('scan', function () {
  return gulp.src([ 'app/elements/**/*.html' ])
    .pipe($.i18nPreprocess({
      constructAttributesRepository: true,
      attributesRepository: attributesRepository,
      srcPath: 'app',
      attributesRepositoryPath: 'app/bower_components/i18n-behavior/i18n-attr-repo.html',
      dropHtml: true
    }))
    .pipe(gulp.dest(dist('elements')))
    .pipe($.size({
      title: 'scan'
    }));
});

// Preprocess HTML for I18N.
gulp.task('preprocess', function () {
  var elements = gulp.src(['app/elements/**/*.html'])
    .pipe($.i18nPreprocess({
      replacingText: true,
      jsonSpace: (config.dev ? 2 : 0),
      srcPath: 'app',
      attributesRepository: attributesRepository
    }))
    .pipe(gulp.dest('.tmp/elements'));

  var stylesHTML = gulp.src(['app/styles/**/*.html'])
    .pipe(gulp.dest('.tmp/styles'));

  var bower = gulp.src(['app/bower_components/**/*'])
    .pipe(gulp.dest('.tmp/bower_components'));

  var scripts = gulp.src(['app/scripts/**/*'])
    .pipe(gulp.dest(dist('scripts')));

  return merge(elements, stylesHTML, bower, scripts)
    .pipe($.size({
      title: 'preprocess'
    }));
});

// Import bundles.{lang}.xlf
gulp.task('import-xliff', function () {
  var xliffPath = path.join('app', 'xliff');
  var x2j = new xliff2bundlejson({});
  return gulp.src([
      'app/**/xliff/bundle.*.xlf'
    ])
    .pipe(through.obj(function (file, enc, callback) {
      var bundle, bundlePath;
      var base = path.basename(file.path, '.xlf').match(/^(.*)[.]([^.]*)$/);
      var xliff = String(file.contents);
      if (base) {
        try {
          bundlePath = path.join(file.base, 'locales', 'bundle.' + base[2] + '.json');
          bundle = JSON.parse(stripBom(fs.readFileSync(bundlePath, 'utf8')));
          x2j.parseXliff(xliff, { bundle: bundle }, function (output) {
            file.contents = new Buffer(JSONstringify(output, null, 2));
            file.path = bundlePath;
            callback(null, file);
          });
        }
        catch (ex) {
          callback(null, file);
        }
      }
      else {
        callback(null, file);
      }
    }))
    .pipe(gulp.dest('app'))
    .pipe($.size({
      title: 'import-xliff'
    }));
});

// Merge changes in default JSON into localized JSON
gulp.task('leverage', function () {
  return gulp.src([
      'app/**/locales/*.json',
      '!app/**/locales/bundle.*.json',
      '!app/bower_components/**/locales/*.json'
    ]) // input localized JSON files in source
    .pipe(through.obj(function (file, enc, callback) {
      var bundle, base = path.basename(file.path, '.json').match(/^(.*)[.]([^.]*)$/);
      if (base) {
        try {
          bundle = JSON.parse(stripBom(fs.readFileSync(path.join(file.base, 'locales', 'bundle.' + base[2] + '.json'), 'utf8')));
          if (bundle[base[1]]) {
            file.contents = new Buffer(JSONstringify(bundle[base[1]], null, 2));
          }
        }
        catch (ex) {}
      }
      callback(null, file);
    }))
    .pipe($.i18nLeverage({
      jsonSpace: (config.dev ? 2 : 0), // JSON format
      srcPath: 'app', // path to source root
      distPath: '.tmp', // path to dist root to fetch next default JSON files
      bundles: bundles // output bundles object
    }))
    .pipe(gulp.dest(dist())) // path to output next localized JSON files
    .pipe($.size({
      title: 'leverage'
    }));
});

// Generate bundles.{lang}.json
gulp.task('bundles', function (callback) {
  var localesPath = dist('locales');
  try {
    fs.mkdirSync(localesPath);
  }
  catch (e) {
  }
  for (var lang in bundles) {
    bundles[lang].bundle = true;
    if (lang) { // localized bundle
      fs.writeFileSync(path.join(localesPath, 'bundle.' + lang + '.json'), 
                        JSONstringify(bundles[lang], null, config.dev ? 2 : 0));
    }
    else { // default bundle
      fs.writeFileSync(dist('bundle.json'),
                        JSONstringify(bundles[lang], null, config.dev ? 2 : 0));
    }
  }
  callback();
});

// Generate bundles.{lang}.xlf
gulp.task('export-xliff', function (callback) {
  var srcLanguage = 'en';
  var xliffPath = dist('xliff');
  var x2j = new xliff2bundlejson({
    date: new Date()
  });
  var promises = [];
  try {
    fs.mkdirSync(xliffPath);
  }
  catch (e) {
  }
  for (var lang in bundles) {
    if (lang) {
      (function (destLanguage) {
        promises.push(new Promise(function (resolve, reject) {
          x2j.parseJSON(bundles, {
            srcLanguage: srcLanguage,
            destLanguage: destLanguage,
            maxDepth: 32
          }, function (output) {
            fs.writeFile(path.join(xliffPath, 'bundle.' + destLanguage + '.xlf'), output, resolve);
          });
        }));
      })(lang);
    }
  }
  Promise.all(promises).then(function (outputs) {
    callback();
  });
});

// Feedback sources with updated JSON
gulp.task('feedback', function () {
  // Copy from dist
  var locales = gulp.src(config.dev ? [
      'dist/**/locales/*.json',
      'dist/**/xliff/*.xlf',
      //'!dist/locales/bundle.*.json',
      '!dist/bower_components/**/*'
    ] : [])
    .pipe(gulp.dest('app'));

  // Regenerate default JSON files
  var elementDefault = gulp.src(config.dev ? [ 'app/elements/**/*.html' ] : [])
    .pipe($.i18nPreprocess({
      replacingText: false,
      jsonSpace: 2,
      srcPath: 'app',
      dropHtml: true,
      attributesRepository: attributesRepository
    }))
    .pipe(gulp.dest('app/elements'));

  // Regenerate default JSON files for non-custom-element HTMLs, i.e., i18n-dom-bind
  var appDefault = gulp.src(config.dev ? [
      'app/**/*.html',
      '!app/{elements,styles,test,bower_components}/**/*.html'
    ] : [])
    .pipe($.i18nPreprocess({
      replacingText: false,
      jsonSpace: 2,
      srcPath: 'app',
      force: true,
      dropHtml: true,
      attributesRepository: attributesRepository
    }))
    .pipe(gulp.dest('app'));

  return merge(locales, elementDefault, appDefault)
    .pipe($.size({
      title: 'feedback'
    }));
});

// Add locales to I18N-ready elements and pages
gulp.task('locales', function() {
  var elements = gulp.src([ 'app/elements/**/*.html' ], { base: 'app' })
    .pipe($.grepContents(/i18n-behavior.html/))
    .pipe($.grepContents(/<dom-module /));

  var pages = gulp.src([
      'app/**/*.html',
      '!app/{bower_components,styles,scripts,images,fonts}/**/*'
    ], { base: 'app' })
    .pipe($.grepContents(/is=['"]i18n-dom-bind['"]/));

  return merge(elements, pages)
    .pipe($.i18nAddLocales(config.locales))
    .pipe(gulp.dest('app'))
    .pipe($.size({
      title: 'locales'
    }));
});

// Compile and automatically prefix stylesheets
gulp.task('styles', function() {
  return styleTask('styles', ['**/*.css']);
});

// Ensure that we are not missing required files for the project
// "dot" files are specifically tricky due to them being hidden on
// some systems.
gulp.task('ensureFiles', function(cb) {
  var requiredFiles = ['.bowerrc'];

  ensureFiles(requiredFiles.map(function(p) {
    return path.join(__dirname, p);
  }), cb);
});

// Optimize images
gulp.task('images', function() {
  return imageOptimizeTask('app/images/**/*', dist('images'));
});

// Copy all files at the root level (app)
gulp.task('copy', function() {
  var app = gulp.src([
    'app/*',
    '!app/test',
    '!app/elements',
    '!app/bower_components',
    '!app/cache-config.json',
    '!**/.DS_Store'
  ], {
    dot: true
  })
  .pipe($.if('*.html', $.i18nPreprocess({
    force: true,
    replacingText: true,
    jsonSpace: (config.dev ? 2 : 0),
    srcPath: 'app',
    attributesRepository: attributesRepository
  })))
  .pipe(gulp.dest('.tmp'))
  .pipe(gulp.dest(dist()));

  // Copy over only the bower_components we need
  // These are things which cannot be vulcanized
  var bower = gulp.src([
    'app/bower_components/{webcomponentsjs,platinum-sw,sw-toolbox,promise-polyfill}/**/*'
  ]).pipe(gulp.dest(dist('bower_components')));

  return merge(app, bower)
    .pipe($.size({
      title: 'copy'
    }));
});

// Copy web fonts to dist
gulp.task('fonts', function() {
  return gulp.src(['app/fonts/**'])
    .pipe(gulp.dest(dist('fonts')))
    .pipe($.size({
      title: 'fonts'
    }));
});

// Scan your HTML for assets & optimize them
gulp.task('html', function() {
  return optimizeHtmlTask(
    ['.tmp/**/*.html', '!.tmp/{elements,test,bower_components}/**/*.html'],
    dist());
});

// Vulcanize granular configuration
gulp.task('vulcanize', function() {
  return gulp.src('.tmp/elements/elements.html')
    .pipe($.vulcanize({
      stripComments: true,
      inlineCss: true,
      inlineScripts: true
    }))
    .pipe(gulp.dest(dist('elements')))
    .pipe($.size({title: 'vulcanize'}));
});

// Generate config data for the <sw-precache-cache> element.
// This include a list of files that should be precached, as well as a (hopefully unique) cache
// id that ensure that multiple PSK projects don't share the same Cache Storage.
// This task does not run by default, but if you are interested in using service worker caching
// in your project, please enable it within the 'default' task.
// See https://github.com/PolymerElements/polymer-starter-kit#enable-service-worker-support
// for more context.
gulp.task('cache-config', function(callback) {
  var dir = dist();
  var config = {
    cacheId: packageJson.name || path.basename(__dirname),
    disabled: false
  };

  glob([
    'index.html',
    './',
    'bower_components/webcomponentsjs/webcomponents-lite.min.js',
    '{elements,scripts,styles}/**/*.*'],
    {cwd: dir}, function(error, files) {
    if (error) {
      callback(error);
    } else {
      config.precache = files;

      var md5 = crypto.createHash('md5');
      md5.update(JSON.stringify(config.precache));
      config.precacheFingerprint = md5.digest('hex');

      var configPath = path.join(dir, 'cache-config.json');
      fs.writeFile(configPath, JSON.stringify(config), callback);
    }
  });
});

// Clean output directory
gulp.task('clean', function() {
  return del(['.tmp', dist()]);
});

// Watch files for changes & reload
gulp.task('serve', ['styles'], function() {
  browserSync({
    port: 5000,
    notify: false,
    logPrefix: 'PSK',
    snippetOptions: {
      rule: {
        match: '<span id="browser-sync-binding"></span>',
        fn: function(snippet) {
          return snippet;
        }
      }
    },
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: {
      baseDir: ['.tmp', 'app'],
      middleware: [historyApiFallback()]
    }
  });

  gulp.watch(['app/**/*.html', '!app/bower_components/**/*.html'], reload);
  gulp.watch(['app/styles/**/*.css'], ['styles', reload]);
  gulp.watch(['app/scripts/**/*.js'], reload);
  gulp.watch(['app/images/**/*'], reload);
});

// Build and serve the output from the dist build
gulp.task('serve:dist', ['default'], function() {
  browserSync({
    port: 5001,
    notify: false,
    logPrefix: 'PSK',
    snippetOptions: {
      rule: {
        match: '<span id="browser-sync-binding"></span>',
        fn: function(snippet) {
          return snippet;
        }
      }
    },
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: dist(),
    middleware: [historyApiFallback()]
  });
});

// Build production files, the default task
gulp.task('default', ['clean'], function(cb) {
  // Uncomment 'cache-config' if you are going to use service workers.
  runSequence(
    'scan', 'preprocess',
    ['ensureFiles', 'copy', 'styles'],
    ['images', 'fonts', 'html'],
    'import-xliff',
    'leverage', 'bundles',
    'export-xliff',
    'vulcanize', // 'cache-config',
    'feedback',
    cb);
});

// Build then deploy to GitHub pages gh-pages branch
gulp.task('build-deploy-gh-pages', function(cb) {
  runSequence(
    'default',
    'deploy-gh-pages',
    cb);
});

// Deploy to GitHub pages gh-pages branch
gulp.task('deploy-gh-pages', function() {
  return gulp.src(dist('**/*'))
    // Check if running task from Travis CI, if so run using GH_TOKEN
    // otherwise run using ghPages defaults.
    .pipe($.if(process.env.TRAVIS === 'true', $.ghPages({
      remoteUrl: 'https://$GH_TOKEN@github.com/polymerelements/polymer-starter-kit.git',
      silent: true,
      branch: 'gh-pages'
    }), $.ghPages()));
});

// Load tasks for web-component-tester
// Adds tasks for `gulp test:local` and `gulp test:remote`
require('web-component-tester').gulp.init(gulp);

// Load custom tasks from the `tasks` directory
try {
  require('require-dir')('tasks');
} catch (err) {
  // Do nothing
}
