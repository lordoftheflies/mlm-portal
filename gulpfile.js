'use strict';
var gulp = require('gulp');
var gutil = require('gulp-util');
var debug = require('gulp-debug');
var gulpif = require('gulp-if');
var gulpignore = require('gulp-ignore');
var gulpmatch = require('gulp-match');
var sort = require('gulp-sort');
var grepContents = require('gulp-grep-contents');
var size = require('gulp-size');
var merge = require('gulp-merge');
var through = require('through2');
var path = require('path');
var stripBom = require('strip-bom');
var JSONstringify = require('json-stringify-safe');
var i18nPreprocess = require('gulp-i18n-preprocess');
var i18nLeverage = require('gulp-i18n-leverage');
var XliffConv = require('xliff-conv');
var i18nAddLocales = require('gulp-i18n-add-locales');
var logging = require('plylog');
var mergeStream = require('merge-stream');
var isPolymerCLI = global._babelPolyfill;
// Global object to store localizable attributes repository
var attributesRepository = {};
// Bundles object
var prevBundles = {};
var bundles = {};
var title = 'I18N transform';
var tmpDir = '.tmp';
var xliffOptions = {};
// Scan HTMLs and construct localizable attributes repository
var scan = gulpif('*.html', i18nPreprocess({
    constructAttributesRepository: true, // construct attributes repository
    attributesRepository: attributesRepository, // output object
    srcPath: '.', // path to source root
    attributesRepositoryPath:
            'bower_components/i18n-behavior/i18n-attr-repo.html', // path to i18n-attr-repo.html
    dropHtml: false // do not drop HTMLs
}));
var basenameSort = sort({
    comparator: function (file1, file2) {
        var base1 = path.basename(file1.path).replace(/^bundle[.]/, ' bundle.');
        var base2 = path.basename(file2.path).replace(/^bundle[.]/, ' bundle.');
        return base1.localeCompare(base2);
    }
});
var dropDefaultJSON = gulpignore(['src/**/*.json', '!**/locales/*.json']);
var preprocess = gulpif('*.html', i18nPreprocess({
    replacingText: true, // replace UI texts with {{annotations}}
    jsonSpace: 2, // JSON format with 2 spaces
    srcPath: '.', // path to source root
    attributesRepository: attributesRepository // input attributes repository
}));
var tmpJSON = gulpif(['src/**/*.json', '!src/**/locales/*'], gulp.dest(tmpDir));
var unbundleFiles = [];
var importXliff = through.obj(function (file, enc, callback) {
    // bundle files must come earlier
    unbundleFiles.push(file);
    callback();
}, function (callback) {
    var match;
    var file;
    var bundleFileMap = {};
    var xliffConv = new XliffConv(xliffOptions);
    while (unbundleFiles.length > 0) {
        file = unbundleFiles.shift();
        if (path.basename(file.path).match(/^bundle[.]json$/)) {
            prevBundles[''] = JSON.parse(stripBom(String(file.contents)));
            bundleFileMap[''] = file;
        } else if (match = path.basename(file.path).match(/^bundle[.]([^.\/]*)[.]json$/)) {
            prevBundles[match[1]] = JSON.parse(stripBom(String(file.contents)));
            bundleFileMap[match[1]] = file;
        } else if (match = path.basename(file.path).match(/^bundle[.]([^.\/]*)[.]xlf$/)) {
            xliffConv.parseXliff(String(file.contents), {bundle: prevBundles[match[1]]}, function (output) {
                if (bundleFileMap[match[1]]) {
                    bundleFileMap[match[1]].contents = new Buffer(JSONstringify(output, null, 2));
                }
            });
        } else if (gulpmatch(file, '**/locales/*.json') &&
                (match = path.basename(file.path, '.json').match(/^([^.]*)[.]([^.]*)/))) {
            if (prevBundles[match[2]] && prevBundles[match[2]][match[1]]) {
                file.contents = new Buffer(JSONstringify(prevBundles[match[2]][match[1]], null, 2));
            }
        }
        this.push(file);
    }
    callback();
});
var leverage = gulpif(['src/**/locales/*.json', '!**/locales/bundle.*.json'], i18nLeverage({
    jsonSpace: 2, // JSON format with 2 spaces
    srcPath: '', // path to source root
    distPath: '/' + tmpDir, // path to dist root to fetch next default JSON files
    bundles: bundles // output bundles object
}));
var bundleFiles = [];
var exportXliff = through.obj(function (file, enc, callback) {
    bundleFiles.push(file);
    callback();
}, function (callback) {
    var file;
    var cwd = bundleFiles[0].cwd;
    var base = bundleFiles[0].base;
    var xliffConv = new XliffConv(xliffOptions);
    var srcLanguage = 'en';
    var promises = [];
    var self = this;
    var lang;
    while (bundleFiles.length > 0) {
        file = bundleFiles.shift();
        if (!gulpmatch(file, ['**/bundle.json', '**/locales/bundle.*.json', '**/xliff/bundle.*.xlf'])) {
            this.push(file);
        }
    }
    for (lang in bundles) {
        bundles[lang].bundle = true;
        this.push(new gutil.File({
            cwd: cwd,
            base: base,
            path: lang ? path.join(cwd, 'locales', 'bundle.' + lang + '.json')
                    : path.join(cwd, 'bundle.json'),
            contents: new Buffer(JSONstringify(bundles[lang], null, 2))
        }));
    }
    for (lang in bundles) {
        if (lang) {
            (function (destLanguage) {
                promises.push(new Promise(function (resolve, reject) {
                    xliffConv.parseJSON(bundles, {
                        srcLanguage: srcLanguage,
                        destLanguage: destLanguage
                    }, function (output) {
                        self.push(new gutil.File({
                            cwd: cwd,
                            base: base,
                            path: path.join(cwd, 'xliff', 'bundle.' + destLanguage + '.xlf'),
                            contents: new Buffer(output)
                        }));
                        resolve();
                    });
                }));
            })(lang);
        }
    }
    Promise.all(promises).then(function (outputs) {
        callback();
    });
});
var feedback = gulpif(['**/bundle.json', '**/locales/*.json', '**/src/**/*.json', '**/xliff/bundle.*.xlf'], gulp.dest('.'));
var config = {
    // list of target locales to add
    locales: gutil.env.targets ? gutil.env.targets.split(/ /) : []
}

// Gulp task to add locales to I18N-ready elements and pages
// Usage: gulp locales --targets="{space separated list of target locales}"
gulp.task('locales', function () {
    var elements = gulp.src([
        'src/**/*.html'
    ], {base: '.'})
            .pipe(grepContents(/i18n-behavior.html/))
            .pipe(grepContents(/<dom-module /));
    var pages = gulp.src(['index.html'], {base: '.'})
            .pipe(grepContents(/is=['"]i18n-dom-bind['"]/));
    return merge(elements, pages)
            .pipe(i18nAddLocales(config.locales))
            .pipe(gulp.dest('.'))
            .pipe(debug({title: 'Add locales:'}))
});
if (isPolymerCLI) {
    module.exports = {
        transformers: [
            scan,
            basenameSort,
            dropDefaultJSON,
            preprocess,
            tmpJSON,
            importXliff,
            leverage,
            exportXliff,
            feedback,
            debug({title: title}),
            size({title: title})
        ]
    };
} else {
    var polymer = require('polymer-build');
    //const optimize = require('polymer-build/lib/optimize').optimize;
    //const precache = require('polymer-build/lib/sw-precache');
    var PolymerProject = polymer.PolymerProject;
    var fork = polymer.forkStream;
    var polymerConfig = require('./polymer.json');
    logging.setVerbose();

    var project = new PolymerProject({
        root: process.cwd(),
        entrypoint: polymerConfig.entrypoint,
        shell: polymerConfig.shell
    });
    gulp.task('default', function () {
        // process source files in the project
        var sources = project.sources()
                .pipe(project.splitHtml())
                // I18N processes
                .pipe(scan)
                .pipe(basenameSort)
                .pipe(dropDefaultJSON)
                .pipe(preprocess)
                .pipe(tmpJSON)
                .pipe(importXliff)
                .pipe(leverage)
                .pipe(exportXliff)
                .pipe(feedback)
                .pipe(debug({title: title}))
                .pipe(size({title: title}))
                // add compilers or optimizers here!
                .pipe(project.rejoinHtml());
        // process dependencies
        var dependencies = project.dependencies()
                .pipe(project.splitHtml())
                // add compilers or optimizers here!
                .pipe(project.rejoinHtml());
        // merge the source and dependencies streams to we can analyze the project
        console.log('----------------------------------------' + JSON.stringify(project.analyze));
        var allFiles = mergeStream(sources, dependencies);
//                .pipe(project.analyze);
        // fork the stream in case downstream transformers mutate the files
        // this fork will vulcanize the project
        var bundled = fork(allFiles)
//                .pipe(project.bundle)
                // write to the bundled folder
                .pipe(gulp.dest('build/bundled'));
        var unbundled = fork(allFiles)
                // write to the unbundled folder
                .pipe(gulp.dest('build/unbundled'));
        return mergeStream(bundled, unbundled);
    });
}