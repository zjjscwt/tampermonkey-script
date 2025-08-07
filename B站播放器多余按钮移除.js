// ==UserScript==
// @name           B站播放器多余按钮移除
// @namespace      http://tampermonkey.net/
// @version        1.1
// @description    移除B站视频页面上的指定浮窗按钮
// @match          https://www.bilibili.com/video/*
// @run-at         document-end
// @grant          none
// @license        MIT
// ==/UserScript==

(function() {
    'use strict';

    // 定义需要移除的按钮类名
    const targetClasses = [
        'bpx-player-ctrl-pip',
        'bpx-player-ctrl-web',
        'bpx-player-ctrl-wide'
    ];

    // 生成CSS选择器
    const selector = targetClasses.map(className =>
        `.bpx-player-ctrl-btn.${className}`
    ).join(',');

    // 删除匹配的元素
    function removeElementsBySelector(s) {
        document.querySelectorAll(s).forEach(element => {
            element.remove();
        });
    }

    // 立即删除已存在的元素
    removeElementsBySelector(selector);

    // 使用MutationObserver监听DOM变化
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            const nodes = mutation.addedNodes;
            nodes.forEach(node => {
                if (node.matches && node.matches(selector)) {
                    node.remove();
                }
            });
        });
    });

    // 开始观察整个文档的变化
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
