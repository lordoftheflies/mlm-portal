/* 
 * Application loader script.
 * Features
 * - Lazy Polymer module loding.
 * - Application component embedding.
 */

'use strict';
/* global polymerLoader */
/*jshint unused:false*/
/*jshint -W079*/

(function () {
    if ('registerElement' in document
            && 'import' in document.createElement('link')
            && 'content' in document.createElement('template')) {
        // browser has web components
    } else {
        // polyfill web components
        var e = document.createElement('script');
        e.src = '/bower_components/webcomponentsjs/webcomponents-lite.min.js';
        document.body.appendChild(e);
    }
})();

// load pre-caching service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/service-worker.js');
    });
}


var polymerLoader = (function () {

    // Function for creating a link element and inserting it into the <head> of the html document
    function addLinkTag(elementType, address, shim, loadTrigger) {
        var tag = document.createElement('link');
        tag.rel = elementType;
        tag.href = address;
        if (shim) {
            // add the shim-shadowdom attribute
            tag.setAttribute('shim-shadowdom', '');
        }
        if (loadTrigger) {
            // This file needs to be loaded before inserting the Polymer Application
            // when finished loading it will call the polymerLoader.insertPolymerApplication() function
            tag.setAttribute('onload', 'polymerLoader.insertPolymerApplication()');
            expectedCalls++;
        }
        document.getElementsByTagName('head')[0].appendChild(tag);
    }

    var pgApploaded = false;

    function loadPolymerApplication() {
        // Only insert once.
        if (!pgApploaded) {
            addLinkTag('stylesheet', 'styles/layered.css', true);
            addLinkTag('stylesheet', 'styles/main.css');
            addLinkTag('import', '/src/my-app.html', false, true);
            pgApploaded = true;
        }
    }

    // Counter variable for insertPolymerApplication() calls
    var callCount = 0;
    var expectedCalls = 0;

    function insertPolymerApplication() {
        callCount++;
        // Only when callCount >= expectedCalls
        // The application is only inserted after all required files have loaded
        // for the application to work.
        if (callCount >= expectedCalls) {
            // here is the html that is inserted when everything is loaded.
            document.querySelector('body').innerHTML += '<my-app id="app" unresolved prefix="my" landing-page="view1">My App</my-app>';
        }
    }


    return {
        insertPolymerApplication: function () {
            insertPolymerApplication();
        },
        loadPolymerApplication: function () {
            loadPolymerApplication();
        }
    };
})(document);