/*
Language: Brainfuck++
Description:  Brainfuck++ (bfpp) extends Brainfuck with macros, functions,
              strings, debug directives, for-loops, and pointer references.
File types: .bfpp
*/

module.exports = function bfpp(hljs) {
  return {
    name: 'Brainfuck++',
    aliases: ['bfpp'],
    contains: [

      {
        className: 'comment-bfpp',
        begin: /#/,
        end: /\\#|$/
      },

      {
        className: 'string-bfpp',
        begin: /"/,
        end: /"|$/,
        contains: [{ match: /\\./, className: 'escape-bfpp' }]
      },
      {
        className: 'string-bfpp',
        begin: /'/,
        end: /'|$/,
        contains: [{ match: /\\./, className: 'escape-bfpp' }]
      },

      { match: /%[*$&]/, className: 'extern-bfpp' },
      { match: /\^&&?/,  className: 'threaded-bfpp' },
      { match: /\^\$+/,  className: 'threaded-bfpp' },
      { match: /\^!/,  className: 'threaded-bfpp' },
      { match: /\^/,  className: 'threaded-bfpp' },
      { match: /(?<=\^\{)\$+/,  className: 'threaded-bfpp' },

      { match: /&&?\*/, className: 'func-bfpp' },
      { match: /&\$/,   className: 'func-bfpp' },
      { match: /&&?/,   className: 'func-bfpp' },
      { match: /\$!/,   className: 'func-bfpp' },
      { match: /\$+\*/, className: 'func-bfpp' },
      { match: /\$+/,   className: 'func-bfpp' },


      { match: /[a-zA-Z_]\w*/, className: 'name-bfpp' },

      { match: /@\./,   className: 'debug-bfpp' },
      { match: /@\$/,   className: 'debug-bfpp' },
      { match: /@!/,    className: 'debug-bfpp' },
      { match: /@/,     className: 'debug-bfpp' },

      { match: /[{}]/,  className: 'bracket-bfpp' },
      { match: /[\[\]]/, className: 'bracket-bfpp' },
      { match: /[\(\)]/, className: 'macro-bracket-bfpp' },

      { match: /[.,]/,   className: 'operator-bfpp' },
      { match: /[*~]/,   className: 'operator-bfpp' },
      { match: /[+\-<>]/, className: 'operator-bfpp' },
      { match: /!/, className: 'operator-bfpp' },

      { match: /(?<=[$*])[0-9]+/, className: 'param-bfpp' },
      { match: /[0-9]+/, className: 'number-bfpp' }

    ]
  };
};