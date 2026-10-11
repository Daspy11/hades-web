#! /bin/bash

# Run this if any icons are modified. It regenerates the index.theme files.
#
# Web port: the icon themes are bundled by Vite (see src/lib/GI/Gtk/IconTheme.ts), which reads
# index.theme directly, so there is no icon-theme.cache to update.

function createTheme () {

   THEME_NAME=$(basename "$1")
   THEME_COMMENT="$THEME_NAME Icon Theme"

   OUTPUT=$1



   echo "Creating icon theme '$THEME_NAME' in '$OUTPUT'"

   pushd "$OUTPUT"

   echo "Creating index.theme"

   echo -e "[Icon Theme]\nName=$THEME_NAME\nComment=$THEME_COMMENT\n" > index.theme
   echo -n "Directories=" >> index.theme

   DIRS=`find * -type d | grep -v git | grep "/" | sort -r`
   for foo in $DIRS
   do
   	echo -n "$foo," >> index.theme
   done

   DIRS=`find * -type d | grep -v git | grep -v scalable | grep "/" | sort -r`
   for foo in $DIRS
   do
     size=`echo $foo | sed 's/\x.*//'`
     type="Fixed"
     maxsize="MaxSize=512"
     echo -en "\n\n[$foo]\nSize=$size\nContext=`basename $foo`\nType=$type\n$maxsize" >> index.theme
   done

   DIRS=`find * -type d | grep -v git | grep scalable | grep "/" | sort -r`
   for foo in $DIRS
   do
     type="Scalable"
     echo -en "\n\n[$foo]\nMinSize=1\nSize=128\nMaxSize=512\nContext=`basename $foo`\nType=$type\n" >> index.theme
   done
   echo "Done"

   popd
}


cd "$(dirname "$0")/.."
createTheme "src/dsm/share/Diametric"
createTheme "src/dsm/share/hicolor"
createTheme "src/hades/share/hicolor"
