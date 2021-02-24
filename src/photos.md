---
title: Paul Kane - Photos
layout: layouts/home.njk
---
<h1 class="font-bold text-7xl">My favourite photos.</h1>
<p class="text-xl mt-4">I share some of my favourite photos here.</p>

{%- for photo in photos -%}  
    <img class="mt-4 rounded-xl" src="../img/{{ photo.imgName }}" />
    {{ photo.caption }}
{%- endfor -%}

